export const fmtIST = (iso) => iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

export const SOURCE_LABEL = {
  welcome: "Welcome automation", campaign: "Campaign", birthday: "Birthday wish", staff: "Staff",
  staff_template: "Staff template", bot: "Chatbot", customer: "Customer", note: "Internal note",
};

export const CONV_STATUS = { waiting_team: "Waiting for Team", waiting_customer: "Waiting for Customer", resolved: "Resolved" };

export const FILTERS = [
  ["all", "All"], ["mine", "Assigned to Me"], ["unassigned", "Unassigned"], ["unread", "Unread"],
  ["waiting_customer", "Waiting for Customer"], ["waiting_team", "Waiting for Team"], ["resolved", "Resolved"], ["unmatched", "Unmatched"],
];

export const newClientId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const errMsg = (e, fb = "Failed") => e?.response?.data?.detail || fb;
