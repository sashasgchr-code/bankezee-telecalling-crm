import React, { useState } from "react";
import { ChevronDown, ChevronUp, ClipboardList, Car } from "lucide-react";

const GROUPS = [
  ["Vehicle Details", /car|vehicle|model|manufactur|make|registration year|variant/i],
  ["Loan Details", /loan|amount|outstanding|emi|cibil|credit|bank|tenure|obligation/i],
  ["Employment Details", /salary|income|employ|business|company|turnover|profession|occupation|itr|gst/i],
  ["Customer Details", /name|phone|mobile|email|city|location|pin|state|address|age|dob/i],
];
const groupOf = (label) => (GROUPS.find(([, re]) => re.test(label)) || ["Other Answers"])[0];

// Every answer the customer submitted on the Meta lead form (captured dynamically at sync, incl. future questions).
export default function MetaFormAnswers({ lead }) {
  const answers = lead.form_answers || [];
  const [open, setOpen] = useState(answers.length <= 8);
  const car = lead.car_loan_profile;
  if (!answers.length && !car && !lead.campaign_type) return null;
  const grouped = {};
  answers.forEach((a) => { const g = groupOf(a.label); (grouped[g] = grouped[g] || []).push(a); });
  const order = [...GROUPS.map(([g]) => g), "Other Answers"].filter((g) => grouped[g]);
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3" data-testid="meta-form-answers">
      {(lead.campaign_type || car) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs" data-testid="car-loan-profile">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800"><Car size={12} />{lead.campaign_type || "Car Loans"}</span>
          {car?.employment_type && <span className="rounded-full bg-white border border-slate-200 px-2 py-0.5">Employment: <b>{car.employment_type}</b></span>}
          {car?.business_registrations && <span className="rounded-full bg-white border border-slate-200 px-2 py-0.5" data-testid="car-business-registrations">Registrations: <b>{car.business_registrations.length ? car.business_registrations.join(", ") : "None of the Above"}</b></span>}
          {car?.chatbot_status && <span className="rounded-full bg-white border border-slate-200 px-2 py-0.5">Chatbot: <b>{car.chatbot_status}{car.chatbot_step ? ` · ${car.chatbot_step}` : ""}</b></span>}
        </div>
      )}
      {answers.length > 0 && (
        <>
          <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500" data-testid="meta-form-answers-toggle">
            <ClipboardList size={14} />Meta form answers ({answers.length})<span className="ml-auto normal-case font-medium text-slate-600">{open ? "Hide" : "View All Details"}</span>{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {open && order.map((g) => (
            <div key={g} className="mt-2">
              <p className="text-[11px] font-semibold text-slate-400 uppercase">{g}</p>
              <dl className="mt-1 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                {grouped[g].map((a) => (
                  <div key={a.key} className="min-w-0" data-testid="meta-form-answer">
                    <dt className="text-[11px] text-slate-500 break-words">{a.label}</dt>
                    <dd className="text-sm font-medium text-slate-800 break-words">{a.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
