"""
Database configuration and connection
"""
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "bankezee_connect")

# MongoDB client
# Bounded pool + sane timeouts so a managed Atlas cluster cannot exhaust the pod's
# resources or hang startup/rollout. serverSelectionTimeout fails fast if Atlas is
# unreachable; the pool cap keeps memory/connection use predictable under load.
client = AsyncIOMotorClient(
    MONGO_URL,
    maxPoolSize=int(os.environ.get("MONGO_MAX_POOL_SIZE", "50")),
    minPoolSize=0,
    maxIdleTimeMS=60000,
    serverSelectionTimeoutMS=8000,
    connectTimeoutMS=10000,
    retryWrites=True,
)
db = client[DB_NAME]
