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
