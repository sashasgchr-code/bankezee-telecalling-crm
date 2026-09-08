import React from "react";
import { useParams } from "react-router-dom";
import FileDetailsPage from "../files/FileDetailsPage";
import MetaFileSidebar from "./MetaFileSidebar";
import { useMetaUser, PROC_STATUSES } from "./metaCommon";

// Meta File Detail = the EXACT Connect File-Detail component, pointed at the Meta compat adapter.
// Zero duplication: any future File-Detail fix flows to both Connect and Meta.
const META_STATUS_OPTIONS = PROC_STATUSES.map((s) => ({ value: s, label: s }));

export default function MetaFileDetail() {
  const { leadId } = useParams();
  const meta = useMetaUser();
  return (
    <FileDetailsPage
      apiBase="/meta/files-compat"
      idOverride={leadId}
      roleOverride={meta.role}
      statusOptions={META_STATUS_OPTIONS}
      mode="meta"
      hideEligibilityCheck
      sidebarExtra={<MetaFileSidebar leadId={leadId} meta={meta} />}
    />
  );
}
