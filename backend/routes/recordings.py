"""
Call recording routes
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timedelta, timezone
from typing import Optional
from pydantic import BaseModel
from bson import ObjectId
import base64
import asyncio

from utils.database import db
from utils.auth import get_current_user, require_admin
from utils.helpers import serialize_doc, serialize_docs, format_duration

router = APIRouter(prefix="/api", tags=["Recordings"])

class RecordingUpload(BaseModel):
    lead_id: str
    lead_name: str
    lead_phone: str
    recording_base64: str
    duration_seconds: int
    recorded_at: str
    file_size_bytes: Optional[int] = None

@router.post("/recordings/upload")
async def upload_recording(data: RecordingUpload, current_user: dict = Depends(get_current_user)):
    """
    Upload a call recording from the mobile app.
    Recording is stored as base64 in MongoDB (for simplicity).
    For production with many recordings, consider using a cloud storage service.
    """
    try:
        # Validate base64 data
        try:
            decoded_data = base64.b64decode(data.recording_base64)
            actual_size = len(decoded_data)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid base64 data: {str(e)}")
        
        # Parse recorded_at timestamp
        try:
            recorded_at = datetime.fromisoformat(data.recorded_at.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            recorded_at = datetime.now(timezone.utc)
        
        # Create recording document
        recording_doc = {
            "user_id": current_user["id"],
            "user_name": current_user.get("name", "Unknown"),
            "lead_id": data.lead_id,
            "lead_name": data.lead_name,
            "lead_phone": data.lead_phone,
            "duration_seconds": data.duration_seconds,
            "file_size_bytes": actual_size,
            "recorded_at": recorded_at,
            "uploaded_at": datetime.now(timezone.utc),
            "recording_data": data.recording_base64,  # Store base64 directly
            "status": "uploaded"
        }
        
        result = await db.call_recordings.insert_one(recording_doc)
        
        # Update lead with last recording info
        try:
            await db.leads.update_one(
                {"_id": ObjectId(data.lead_id)},
                {"$set": {
                    "last_recording_at": recorded_at,
                    "last_recording_id": str(result.inserted_id)
                }}
            )
        except Exception:
            pass  # Lead might not exist anymore
        
        return {
            "success": True,
            "recording_id": str(result.inserted_id),
            "message": "Recording uploaded successfully"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error uploading recording: {str(e)}")

@router.get("/recordings")
async def list_recordings(
    user_id: Optional[str] = None,
    lead_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = 50,
    current_user: dict = Depends(require_admin)
):
    """
    List call recordings for admin.
    Does not return the actual audio data - use /recordings/{id}/audio for that.
    """
    query = {}
    
    if user_id:
        query["user_id"] = user_id
    
    if lead_id:
        query["lead_id"] = lead_id
    
    if start_date and end_date:
        try:
            start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
            end = datetime.fromisoformat(end_date.replace('Z', '+00:00')) + timedelta(days=1)
            query["recorded_at"] = {"$gte": start, "$lt": end}
        except (ValueError, AttributeError):
            pass
    elif start_date:
        try:
            start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
            query["recorded_at"] = {"$gte": start}
        except (ValueError, AttributeError):
            pass
    
    # Fetch recordings without the actual audio data
    recordings = await db.call_recordings.find(
        query,
        {"recording_data": 0}  # Exclude audio data for listing
    ).sort("recorded_at", -1).limit(limit).to_list(limit)
    
    return serialize_docs(recordings)

@router.get("/recordings/stats")
async def get_recording_stats(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(require_admin)
):
    """Get recording statistics for admin dashboard"""
    now = datetime.now(timezone.utc)
    
    if start_date and end_date:
        try:
            start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
            end = datetime.fromisoformat(end_date.replace('Z', '+00:00')) + timedelta(days=1)
        except (ValueError, AttributeError):
            start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            end = start + timedelta(days=1)
    else:
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
    
    # Aggregation for recording stats per user
    pipeline = [
        {"$match": {"recorded_at": {"$gte": start, "$lt": end}}},
        {"$group": {
            "_id": "$user_id",
            "user_name": {"$first": "$user_name"},
            "total_recordings": {"$sum": 1},
            "total_duration_seconds": {"$sum": "$duration_seconds"},
            "total_size_bytes": {"$sum": "$file_size_bytes"}
        }},
        {"$sort": {"total_recordings": -1}}
    ]
    
    stats = await db.call_recordings.aggregate(pipeline).to_list(100)
    
    # Get overall totals
    total_recordings = sum(s["total_recordings"] for s in stats)
    total_duration = sum(s["total_duration_seconds"] for s in stats)
    total_size = sum(s["total_size_bytes"] or 0 for s in stats)
    
    return {
        "period": {
            "start": start.isoformat(),
            "end": end.isoformat()
        },
        "overall": {
            "total_recordings": total_recordings,
            "total_duration_seconds": total_duration,
            "total_duration_formatted": format_duration(total_duration),
            "total_size_bytes": total_size,
            "total_size_mb": round(total_size / (1024 * 1024), 2) if total_size else 0
        },
        "by_user": [
            {
                "user_id": s["_id"],
                "user_name": s["user_name"],
                "total_recordings": s["total_recordings"],
                "total_duration_seconds": s["total_duration_seconds"],
                "total_duration_formatted": format_duration(s["total_duration_seconds"]),
                "total_size_mb": round((s["total_size_bytes"] or 0) / (1024 * 1024), 2)
            }
            for s in stats
        ]
    }

@router.get("/recordings/{recording_id}")
async def get_recording(recording_id: str, current_user: dict = Depends(require_admin)):
    """Get recording details without audio data"""
    recording = await db.call_recordings.find_one(
        {"_id": ObjectId(recording_id)},
        {"recording_data": 0}
    )
    
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")
    
    return serialize_doc(recording)

@router.get("/recordings/{recording_id}/audio")
async def get_recording_audio(recording_id: str, current_user: dict = Depends(require_admin)):
    """Get the actual audio data for playback"""
    recording = await db.call_recordings.find_one({"_id": ObjectId(recording_id)})
    
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")
    
    return {
        "recording_id": str(recording["_id"]),
        "lead_name": recording.get("lead_name", "Unknown"),
        "duration_seconds": recording.get("duration_seconds", 0),
        "audio_base64": recording.get("recording_data", ""),
        "content_type": "audio/mp3"
    }

@router.delete("/recordings/{recording_id}")
async def delete_recording(recording_id: str, current_user: dict = Depends(require_admin)):
    """Delete a recording"""
    result = await db.call_recordings.delete_one({"_id": ObjectId(recording_id)})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Recording not found")
    
    return {"success": True, "message": "Recording deleted"}

