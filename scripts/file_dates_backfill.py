#!/usr/bin/env python3
"""CLI for the File date repair. Dry run by default; --apply writes."""
import argparse, asyncio, json, os, sys
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
sys.path.insert(0, '/app/backend')
load_dotenv('/app/backend/.env')
from utils.file_dates_backfill import run_backfill  # noqa: E402


async def main(apply_mode):
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    if apply_mode:
        from utils.crm_migration import create_backup
        backup = await create_backup(db, await db.leads.count_documents({}))
        print('backup:', backup)
        if not backup['verified']:
            print('ABORTED - backup count does not match live leads count')
            return 1
    report = await run_backfill(db, apply=apply_mode)
    print(json.dumps(report, indent=1, default=str))
    return 1 if report['failed'] else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    sys.exit(asyncio.run(main(parser.parse_args().apply)))
