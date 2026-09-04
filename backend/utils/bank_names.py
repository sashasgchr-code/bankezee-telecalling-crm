"""Canonical lender names.

Legacy CRM eligibility rows carry the bank name as free text ("AXI SBANK", "AIDTYA BIRLA",
"INUDISND"...), which splits one lender across many rows in Bank Performance. This maps every
observed variant onto one canonical name. Reports group by the canonical name; the stored data is
only rewritten by scripts/bank_name_cleanup.py when it is explicitly run with --apply.
"""
import re

# Canonical names for lenders that are not in the bank-policy master but do appear in files
EXTRA_LENDERS = [
    "Hero FinCorp", "Muthoot Finance", "SMFG India Credit", "Protium", "NeoGrowth",
    "KreditBee", "Lendingkart", "Flexiloans", "Mahindra Finance", "DCB Bank", "ICICI HFC",
]

# normalized variant -> canonical name
ALIASES = {
    "HDFC": "HDFC Bank", "HDFCBANK": "HDFC Bank",
    "ICICI": "ICICI Bank", "ICICIBANK": "ICICI Bank", "ICICIHFC": "ICICI HFC",
    "IDFC": "IDFC First Bank", "IDFCBANK": "IDFC First Bank", "IDFCFIRST": "IDFC First Bank",
    "AXIS": "Axis Bank", "AXISBANK": "Axis Bank", "AXISBNAK": "Axis Bank", "AXISBAN": "Axis Bank",
    "AXIBANK": "Axis Bank", "AXISBANKLTD": "Axis Bank",
    "AXISFINANCE": "Axis Finance", "AXSIFINANCE": "Axis Finance", "AXIFINANCE": "Axis Finance",
    "KOTAK": "Kotak Mahindra Bank", "KOTAKMAHINDRA": "Kotak Mahindra Bank",
    "KOTAKMAHINDRABANK": "Kotak Mahindra Bank",
    "INDUSIND": "IndusInd Bank", "INDUSINDBANK": "IndusInd Bank", "INDUS": "IndusInd Bank",
    "INUSIND": "IndusInd Bank", "INUDISND": "IndusInd Bank", "INDUSND": "IndusInd Bank",
    "INDUSINDCIBIL": "IndusInd Bank", "INDUSINDVPL": "IndusInd Bank",
    "INDUSNDBANK": "IndusInd Bank",
    "INDUSINDODPLBT": "IndusInd Bank",
    "CHOLA": "Cholamandalam", "CHOLAMANDALAM": "Cholamandalam",
    "PIRAMAL": "Piramal Capital", "PRIAMAL": "Piramal Capital", "PIRAMALCAPITAL": "Piramal Capital",
    "ADITYA": "Aditya Birla", "ADITYABIRLA": "Aditya Birla", "ADITYABRILA": "Aditya Birla",
    "AIDTYABIRLA": "Aditya Birla", "AIDTYA": "Aditya Birla", "ABFL": "Aditya Birla",
    "POONAWALA": "Poonawalla Fincorp", "POONAWALLA": "Poonawalla Fincorp",
    "POONAWALLAFINCORP": "Poonawalla Fincorp",
    "TATA": "Tata Capital", "TATACAPITAL": "Tata Capital",
    "SMFG": "SMFG India Credit", "SMFGINDIACREDIT": "SMFG India Credit",
    "FULLERTON": "SMFG India Credit", "FULLERTONINDIA": "SMFG India Credit",
    "INCRED": "InCred", "INCREDSELFEMPLOYED": "InCred Self Employed",
    "BAJAJ": "Bajaj Finserv", "BAJAJFINSERV": "Bajaj Finserv", "BAJAJFRESH": "Bajaj Finserv",
    "FINNABLE": "Finnable",
    "HERO": "Hero FinCorp", "HEROFINCORP": "Hero FinCorp",
    "LT": "L&T Finance", "LTFINANCE": "L&T Finance",
    "MUTHOOT": "Muthoot Finance",
    "BANDHAN": "Bandhan Bank", "BANDHANBANK": "Bandhan Bank",
    "YES": "YES Bank", "YESBANK": "YES Bank",
    "PROTIUM": "Protium", "NEOGROWTH": "NeoGrowth",
    "KRAZYBEE": "KreditBee", "KREDITBEE": "KreditBee",
    "LENDINGKART": "Lendingkart", "FLEXILOANS": "Flexiloans",
    "MAHINDRAMAHINDRA": "Mahindra Finance", "MAHINDRAFINANCE": "Mahindra Finance",
    "DCB": "DCB Bank", "DCBBANK": "DCB Bank",
    "FIBE": "Early Salary (Fibe)", "EARLYSALARY": "Early Salary (Fibe)",
    "EARLYSALARYFIBE": "Early Salary (Fibe)",
    "FATAKPAY": "Fatak Pay", "PREFR": "Prefr",
    "SOUTHINDIANBANK": "South Indian Bank",
    "AUSMALLFINANCE": "AU Small Finance", "AUSMALLFINANCEBANK": "AU Small Finance",
    "UTKARSHSMALLFINANCEBANK": "Utkarsh Small Finance Bank",
    "DMIFINANCE": "DMI Finance", "DMI": "DMI Finance",
}

# Values that are not lender names at all - left untouched, never mapped
NON_LENDER = {"NOTELIGIBLE", "NOELIGIBILITY", "NOTSENT", "ALLBANKS", "NA", "NIL"}


def normalize_key(name):
    return re.sub(r"[^A-Z0-9]", "", str(name or "").upper())


def canonical_bank_name(name):
    """Canonical lender name for a raw value, or the trimmed original when it is not a lender."""
    raw = str(name or "").strip()
    if not raw:
        return raw
    key = normalize_key(raw)
    if not key or key in NON_LENDER:
        return raw
    if key in ALIASES:
        return ALIASES[key]
    # exact match against a known canonical spelling (case/punctuation insensitive)
    for canonical in set(ALIASES.values()) | set(EXTRA_LENDERS):
        if normalize_key(canonical) == key:
            return canonical
    return raw


def is_mapped(name):
    """True when the raw value resolves to a different canonical spelling."""
    raw = str(name or "").strip()
    return bool(raw) and canonical_bank_name(raw) != raw
