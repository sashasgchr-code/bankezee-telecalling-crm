// Shared WhatsApp deep link builder - one message template for the whole app.

const buildMessage = (customerName, agentName) => `Hi ${customerName || 'there'},

This is ${agentName} from BankEzee.

I'm calling about merging your multiple loans/credit card payments into one single EMI.

We'd like to understand your current EMIs and check whether we can help you reduce your monthly EMI burden and simplify your repayments.

I tried reaching you but couldn't connect. Please call me back or simply reply "CALL ME" here and I'll get in touch with you.

Regards,
${agentName}
BankEzee – Loan Consolidation Platform
www.BankEzee.com`;

export const normalizePhone = (phone) => {
  // Legacy CRM rows store phones as floats ("9705296810.0")
  let clean = String(phone ?? '').split('.')[0].replace(/[^0-9]/g, '').replace(/^0+/, '');
  if (clean.length === 10 || (clean.length > 10 && !clean.startsWith('91'))) {
    clean = '91' + clean;
  }
  return clean;
};

export const getWhatsAppLink = (phone, customerName, agentName = 'Team') =>
  `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(buildMessage(customerName, agentName))}`;

export const openWhatsApp = (phone, customerName, agentName) => {
  if (!phone) return;
  window.open(getWhatsAppLink(phone, customerName, agentName), '_blank');
};

// ---- Meta CRM WhatsApp (Instagram/Meta leads) ----
// Reuses the SAME phone sanitization (normalizePhone) and the SAME BankEzee signature/contact
// block used by Connect above. Only the opening body differs (Meta-specific copy).
const buildMetaMessage = (customerName, loanType, agentName) => `Hi ${customerName || 'there'},

We have received your application regarding ${loanType || 'loan requirement'} through Instagram/Meta.

We would like to understand your requirement better and discuss the best available solution for you.

If you are looking to consolidate existing debts, reduce your EMI burden, arrange additional funding, or explore a suitable loan option, our team can assist you in checking the available possibilities.

Please call us back on this number or reply here so we can discuss your requirement.

Regards,
${agentName || 'Team'}
BankEzee – Loan Consolidation Platform
www.BankEzee.com`;

export const getMetaWhatsAppLink = (phone, customerName, loanType, agentName = 'Team') =>
  `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(buildMetaMessage(customerName, loanType, agentName))}`;

export const openMetaWhatsApp = (phone, customerName, loanType, agentName) => {
  if (!phone) return;
  window.open(getMetaWhatsAppLink(phone, customerName, loanType, agentName), '_blank');
};
