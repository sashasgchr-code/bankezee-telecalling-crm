"""Public config endpoints — canonical catalogs shared by web + mobile (Connect + Meta)."""
from fastapi import APIRouter

from config.loan_types import catalog

router = APIRouter(prefix="/api/config", tags=["Config"])


@router.get("/loan-types")
async def get_loan_types():
    """Single source of truth for the loan-type dropdown across every surface."""
    return catalog()
