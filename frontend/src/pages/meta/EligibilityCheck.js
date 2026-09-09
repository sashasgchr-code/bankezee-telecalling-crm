import React from "react";
import { useParams } from "react-router-dom";
import EligibilityCheck from "../files/EligibilityCheck";

// Meta Check Eligibility = the EXACT Connect EligibilityCheck page, pointed at the Meta compat
// adapter so the same bank-policy engine runs on Meta file data. No duplication.
export default function MetaEligibilityCheck() {
  const { leadId } = useParams();
  return (
    <EligibilityCheck
      idOverride={leadId}
      mode="meta"
      checkUrl={`/meta/files-compat/${leadId}/check-eligibility`}
      historyUrl={`/meta/files-compat/${leadId}/eligibility-history`}
      leadUrl={`/meta/files-compat/${leadId}/lead`}
    />
  );
}
