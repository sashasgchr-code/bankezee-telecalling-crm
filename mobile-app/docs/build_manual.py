# -*- coding: utf-8 -*-
"""Builds the BankEzee Connect Mobile App — Growth Partner User Manual (PDF).
Phone-frame screen pictures reproduce the CURRENT app's exact labels/stats/buttons/statuses
(read from mobile-app/src/screens). Pure reportlab (no browser needed)."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white, black

W, H = A4
GREEN = HexColor('#16a34a'); GREEN_D = HexColor('#0f7a37'); DARK = HexColor('#0f172a')
SLATE = HexColor('#334155'); GRAY = HexColor('#64748b'); LGRAY = HexColor('#94a3b8')
LIGHT = HexColor('#f1f5f9'); BORDER = HexColor('#e2e8f0'); AMBER = HexColor('#f59e0b')
AMBER_BG = HexColor('#fef3c7'); BLUE = HexColor('#3b82f6'); BLUE_BG = HexColor('#dbeafe')
RED = HexColor('#ef4444'); PURPLE = HexColor('#8b5cf6'); ORANGE = HexColor('#f97316')
GREEN_BG = HexColor('#dcfce7'); GRAY_BG = HexColor('#f1f5f9')

c = canvas.Canvas('/app/BankEzee_Connect_Mobile_Manual_v2.7.1.pdf', pagesize=A4)
_page = [0]


def wrap(text, font, size, max_w):
    c.setFont(font, size)
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if c.stringWidth(t, font, size) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def para(x, y, text, font='Helvetica', size=10.5, color=SLATE, leading=14, max_w=None, bold_lead=None):
    max_w = max_w or (W - x - 20 * mm)
    c.setFillColor(color)
    for ln in wrap(text, font, size, max_w):
        c.setFont(font, size)
        c.drawString(x, y, ln)
        y -= leading
    return y


def bullet(x, y, text, size=10.5, color=SLATE, leading=13.5, gap=9, dot=GREEN, max_w=None):
    max_w = max_w or (W - x - 20 * mm - gap)
    c.setFillColor(dot); c.circle(x + 2, y + 3, 2, fill=1, stroke=0)
    c.setFillColor(color)
    first = True
    for ln in wrap(text, 'Helvetica', size, max_w):
        c.setFont('Helvetica', size); c.drawString(x + gap, y, ln); y -= leading
        first = False
    return y - 3


def header_footer(section):
    _page[0] += 1
    c.setFillColor(DARK); c.rect(0, H - 12 * mm, W, 12 * mm, fill=1, stroke=0)
    c.setFillColor(GREEN); c.rect(0, H - 12 * mm, 4 * mm, 12 * mm, fill=1, stroke=0)
    c.setFillColor(white); c.setFont('Helvetica-Bold', 9)
    c.drawString(14 * mm, H - 8 * mm, 'BANKEZEE CONNECT')
    c.setFillColor(HexColor('#a7f3d0')); c.setFont('Helvetica', 8)
    c.drawRightString(W - 14 * mm, H - 8 * mm, section)
    # footer
    c.setStrokeColor(BORDER); c.setLineWidth(0.5); c.line(14 * mm, 12 * mm, W - 14 * mm, 12 * mm)
    c.setFillColor(GRAY); c.setFont('Helvetica', 8)
    c.drawString(14 * mm, 8 * mm, 'Mobile App User Manual  •  Growth Partner Guide  •  v2.7.1')
    c.drawRightString(W - 14 * mm, 8 * mm, f'Page {_page[0]}')


def h1(x, y, text):
    c.setFillColor(GREEN); c.rect(x, y - 2, 5, 20, fill=1, stroke=0)
    c.setFillColor(DARK); c.setFont('Helvetica-Bold', 17); c.drawString(x + 11, y, text)
    return y - 10


def box(x, y, w, h, kind='IMPORTANT', text=''):
    bg = AMBER_BG if kind == 'IMPORTANT' else BLUE_BG
    edge = AMBER if kind == 'IMPORTANT' else BLUE
    lines = wrap(text, 'Helvetica', 10, w - 34)
    hh = max(h, 16 + len(lines) * 13)
    c.setFillColor(bg); c.setStrokeColor(edge); c.setLineWidth(1)
    c.roundRect(x, y - hh, w, hh, 7, fill=1, stroke=1)
    c.setFillColor(edge); c.roundRect(x, y - hh, 7, hh, 3, fill=1, stroke=0)
    c.setFillColor(edge); c.setFont('Helvetica-Bold', 10)
    c.drawString(x + 14, y - 15, ('⚠ IMPORTANT' if kind == 'IMPORTANT' else '💡 TIP'))
    c.setFillColor(DARK); ty = y - 29
    for ln in lines:
        c.setFont('Helvetica', 10); c.drawString(x + 14, ty, ln); ty -= 13
    return y - hh - 8


# ---------------- phone frame ----------------
def phone(x, y, w=190, h=380, title='BANKEZEE Connect', title_color=GREEN):
    """Draws a phone bezel + green app header; returns (sx, sy, sw, sh, content_top)."""
    c.setFillColor(DARK); c.roundRect(x, y, w, h, 18, fill=1, stroke=0)
    m = 7
    sx, sy, sw, sh = x + m, y + m, w - 2 * m, h - 2 * m
    c.setFillColor(white); c.roundRect(sx, sy, sw, sh, 12, fill=1, stroke=0)
    # status bar
    c.setFillColor(HexColor('#0b1220')); c.roundRect(x + w/2 - 22, y + h - 12, 44, 7, 3, fill=1, stroke=0)
    # app header
    hh = 30
    c.setFillColor(title_color); c.rect(sx, sy + sh - hh, sw, hh, fill=1, stroke=0)
    c.setFillColor(white); c.setFont('Helvetica-Bold', 10)
    c.drawString(sx + 10, sy + sh - hh + 10, title)
    return sx, sy, sw, sh, sy + sh - hh  # content_top y


def stat_card(x, y, w, h, label, value, color, bg):
    c.setFillColor(bg); c.setStrokeColor(color); c.setLineWidth(0.8)
    c.roundRect(x, y - h, w, h, 6, fill=1, stroke=1)
    c.setFillColor(color); c.setFont('Helvetica-Bold', 15); c.drawString(x + 8, y - 20, value)
    c.setFillColor(SLATE); c.setFont('Helvetica', 7.5); c.drawString(x + 8, y - h + 8, label)


def chip(x, y, w, h, text, color, bg, active=False):
    c.setFillColor(color if active else bg); c.setStrokeColor(color); c.setLineWidth(0.8)
    c.roundRect(x, y - h, w, h, h/2, fill=1, stroke=1)
    c.setFillColor(white if active else color); c.setFont('Helvetica-Bold', 7.5)
    c.drawCentredString(x + w/2, y - h + h/2 - 3, text)


def rowline(x, y, w, label, value, lv=DARK):
    c.setFillColor(GRAY); c.setFont('Helvetica', 8); c.drawString(x, y, label)
    c.setFillColor(lv); c.setFont('Helvetica-Bold', 8.5); c.drawRightString(x + w, y, value)


def btn(x, y, w, h, text, color=GREEN):
    c.setFillColor(color); c.roundRect(x, y - h, w, h, 6, fill=1, stroke=0)
    c.setFillColor(white); c.setFont('Helvetica-Bold', 9)
    c.drawCentredString(x + w/2, y - h + h/2 - 3, text)


def callout(x, y, w, text, point=None, color=GREEN):
    lines = wrap(text, 'Helvetica-Bold', 8.5, w - 16)
    hh = 10 + len(lines) * 11
    c.setFillColor(white); c.setStrokeColor(color); c.setLineWidth(1.4)
    c.roundRect(x, y - hh, w, hh, 6, fill=1, stroke=1)
    ty = y - 14
    c.setFillColor(color)
    for ln in lines:
        c.setFont('Helvetica-Bold', 8.5); c.drawString(x + 8, ty, ln); ty -= 11
    if point:
        c.setStrokeColor(color); c.setLineWidth(1.4)
        c.line(x, y - hh/2, point[0], point[1])
        c.setFillColor(color); c.circle(point[0], point[1], 2.4, fill=1, stroke=0)


# ============================================================ COVER
c.setFillColor(DARK); c.rect(0, 0, W, H, fill=1, stroke=0)
c.setFillColor(GREEN); c.rect(0, H - 6 * mm, W, 6 * mm, fill=1, stroke=0)
c.setFillColor(GREEN); c.rect(0, 0, W, 6 * mm, fill=1, stroke=0)
# logo mark
c.setFillColor(GREEN); c.roundRect(W/2 - 34, H - 82 * mm, 68, 68, 16, fill=1, stroke=0)
c.setFillColor(white); c.setFont('Helvetica-Bold', 40); c.drawCentredString(W/2, H - 78 * mm + 10, 'B')
c.setFillColor(white); c.setFont('Helvetica-Bold', 30); c.drawCentredString(W/2, H - 110 * mm, 'BANKEZEE CONNECT')
c.setFillColor(HexColor('#a7f3d0')); c.setFont('Helvetica-Bold', 15)
c.drawCentredString(W/2, H - 120 * mm, 'MOBILE APP — USER MANUAL')
c.setStrokeColor(GREEN); c.setLineWidth(1); c.line(W/2 - 70, H - 126 * mm, W/2 + 70, H - 126 * mm)
c.setFillColor(white); c.setFont('Helvetica', 13)
c.drawCentredString(W/2, H - 138 * mm, 'Growth Partner Guide')
c.setFillColor(LGRAY); c.setFont('Helvetica', 11)
c.drawCentredString(W/2, H - 147 * mm, 'Calls  •  Leads  •  Files  •  Status  •  Earnings')
c.setFillColor(GREEN); c.roundRect(W/2 - 26, H - 168 * mm, 52, 16, 8, fill=1, stroke=0)
c.setFillColor(white); c.setFont('Helvetica-Bold', 11); c.drawCentredString(W/2, H - 168 * mm + 4.5, 'Version 2.7.1')
c.setFillColor(LGRAY); c.setFont('Helvetica', 9)
c.drawCentredString(W/2, 22 * mm, 'For Android — BankEzee Connect Growth Partners')
c.drawCentredString(W/2, 16 * mm, 'Keep your login private • For internal use only')
c.showPage()

# ============================================================ PAGE 1 — Login & Navigation
header_footer('1 • Login & Navigation')
y = H - 22 * mm
y = h1(20 * mm, y, '1.  Login & Getting Around')
y -= 6
para(20 * mm, y, 'Open the BankEzee Connect app on your Android phone, enter your Email and Password, and tap Login. Use only the account given to you by BankEzee.', max_w=W - 40 * mm)
# phone: login
px = 20 * mm; py = H - 205 * mm
sx, sy, sw, sh, ct = phone(px, py, 150, 300, 'BANKEZEE Connect')
c.setFillColor(GREEN_D); c.setFont('Helvetica-Bold', 12); c.drawCentredString(sx + sw/2, ct - 26, 'BANKEZEE Connect')
c.setFillColor(GRAY); c.setFont('Helvetica', 8); c.drawCentredString(sx + sw/2, ct - 38, 'Mobile CRM')
for i, (lab, ph) in enumerate([('Email', 'Enter your email'), ('Password', 'Enter your password')]):
    fy = ct - 62 - i * 46
    c.setFillColor(SLATE); c.setFont('Helvetica-Bold', 8); c.drawString(sx + 14, fy, lab)
    c.setFillColor(white); c.setStrokeColor(BORDER); c.setLineWidth(1)
    c.roundRect(sx + 14, fy - 24, sw - 28, 20, 5, fill=1, stroke=1)
    c.setFillColor(LGRAY); c.setFont('Helvetica', 8); c.drawString(sx + 20, fy - 18, ph)
btn(sx + 14, ct - 156, sw - 28, 24, 'Login')
callout(px + 165, py + 210, 120, 'Tap Login after typing your email & password', point=(sx + sw/2, ct - 150), color=GREEN)
callout(px + 165, py + 120, 120, 'If you are mobile-only and web is blocked, that is normal — keep using this app', color=BLUE)
# nav tabs explanation
tx = 20 * mm; ty = py - 6
ty = h1(tx, ty, 'Your bottom menu (tabs)')
tabs = [('Dashboard', 'Your daily numbers & activity'),
        ('Data', 'Your leads — call them & log outcomes'),
        ('Files', 'Loan files — create & track to disbursal'),
        ('Follow-ups', 'Customers you promised to call back'),
        ('Meta', 'Meta leads (only if Meta is enabled for you)'),
        ('More', 'Attendance, Reports, Policies, Logout')]
ty -= 4
for name, desc in tabs:
    c.setFillColor(GREEN); c.roundRect(tx, ty - 12, 66, 13, 6, fill=1, stroke=0)
    c.setFillColor(white); c.setFont('Helvetica-Bold', 8); c.drawCentredString(tx + 33, ty - 9, name)
    c.setFillColor(SLATE); c.setFont('Helvetica', 9.5); c.drawString(tx + 74, ty - 9, desc)
    ty -= 18
c.showPage()

# ============================================================ PAGE 2 — Dashboard
header_footer('2 • Dashboard')
y = H - 22 * mm
y = h1(20 * mm, y, '2.  Dashboard — your numbers at a glance')
y -= 4
para(20 * mm, y, 'The Dashboard opens first. A toggle at the top switches between This Month and Lifetime totals. Read it top to bottom.', max_w=W - 40 * mm)
px = 20 * mm; py = H - 240 * mm
sx, sy, sw, sh, ct = phone(px, py, 170, 330, 'Dashboard')
# toggle
chip(sx + 12, ct - 8, 70, 16, 'This Month', GREEN, GREEN_BG, active=True)
chip(sx + 88, ct - 8, 70, 16, 'Lifetime', GRAY, GRAY_BG)
c.setFillColor(DARK); c.setFont('Helvetica-Bold', 9); c.drawString(sx + 12, ct - 40, 'My Data')
stat_card(sx + 12, ct - 48, 46, 34, 'Follow Up', '6', PURPLE, HexColor('#f3e5f5'))
stat_card(sx + 62, ct - 48, 46, 34, 'Lead', '18', GREEN, GREEN_BG)
stat_card(sx + 112, ct - 48, 46, 34, 'File', '4', ORANGE, HexColor('#fff3e0'))
c.setFillColor(DARK); c.setFont('Helvetica-Bold', 9); c.drawString(sx + 12, ct - 96, "Today's Activity")
acts = [('Calls', '32'), ('Outgoing', '28'), ('Incoming', '4'), ('Total Talk', '46m'), ('Idle Time', '1h'), ('Login Time', '9:12')]
for i, (l, v) in enumerate(acts):
    cx = sx + 12 + (i % 3) * 50; cy = ct - 104 - (i // 3) * 30
    stat_card(cx, cy, 46, 26, l, v, BLUE, BLUE_BG)
c.setFillColor(DARK); c.setFont('Helvetica-Bold', 9); c.drawString(sx + 12, ct - 172, 'Call Outcomes')
chip(sx + 12, ct - 180, 70, 15, 'Connected 12', GREEN, GREEN_BG)
chip(sx + 88, ct - 180, 78, 15, 'Not Connecting 20', GRAY, GRAY_BG)
c.setFillColor(DARK); c.setFont('Helvetica-Bold', 9); c.drawString(sx + 12, ct - 206, 'Status Breakdown')
for i, (l, col, bg) in enumerate([('Lead', GREEN, GREEN_BG), ('File', ORANGE, HexColor('#fff3e0')), ('Follow Up', PURPLE, HexColor('#f3e5f5'))]):
    chip(sx + 12 + i * 52, ct - 214, 48, 15, l, col, bg)
# right column explanations
ex = px + 185; ey = H - 34 * mm; ew = W - ex - 18 * mm
c.setFillColor(DARK); c.setFont('Helvetica-Bold', 11); c.drawString(ex, ey, 'What the cards mean'); ey -= 16
for t in ['This Month / Lifetime: tap to switch. "This Month" resets monthly; "Lifetime" is your all-time total.',
          'My Data — Follow Up, Lead and File counts assigned to you.',
          'Today\'s Activity — Calls, Outgoing, Incoming, Total Talk time, Idle Time and your Login Time for today.',
          'Call Outcomes — how many calls Connected vs Not Connecting today.',
          'Status Breakdown — how your leads are split across Lead / File / Follow Up.']:
    ey = bullet(ex, ey, t, size=9.5, max_w=ew)
ey = box(ex, ey - 2, ew, 0, 'TIP', 'Check your Dashboard every morning and evening to see your calls, follow-ups and files at a glance.')
c.showPage()

# ============================================================ PAGE 3 — Leads & Calling
header_footer('3 • Leads & Calling')
y = H - 22 * mm
y = h1(20 * mm, y, '3.  Leads & Calling')
y -= 4
para(20 * mm, y, 'Open the Data tab to see your leads. Tap a lead to open it, then tap Call. When the call ends, the app shows the Post-Call screen — always fill it in.', max_w=W - 40 * mm)
px = 20 * mm; py = H - 250 * mm
sx, sy, sw, sh, ct = phone(px, py, 170, 300, 'Log Call Outcome')
c.setFillColor(DARK); c.setFont('Helvetica-Bold', 9); c.drawString(sx + 12, ct - 16, 'How did the call go?')
chip(sx + 12, ct - 28, 150, 14, '📞 Call Duration: 2m 14s (from call log)', GREEN, GREEN_BG)
c.setFillColor(SLATE); c.setFont('Helvetica-Bold', 8); c.drawString(sx + 12, ct - 50, 'Call Outcome *')
outs = ['Connected', 'No Answer', 'Switched Off', 'Not Connecting', 'Busy', 'Wrong Number', 'Voicemail']
ox, oy = sx + 12, ct - 58
for i, o in enumerate(outs):
    w = 8 + c.stringWidth(o, 'Helvetica-Bold', 7.5) + 8
    if ox + w > sx + sw - 12:
        ox = sx + 12; oy -= 20
    chip(ox, oy, w, 15, o, GREEN if o == 'Connected' else SLATE, GREEN_BG if o == 'Connected' else GRAY_BG, active=(o == 'Connected'))
    ox += w + 6
oy -= 26
c.setFillColor(SLATE); c.setFont('Helvetica-Bold', 8); c.drawString(sx + 12, oy, 'Update Status (optional)')
oy -= 8
for i, (l, col, bg) in enumerate([('New', BLUE, BLUE_BG), ('Follow Up', PURPLE, HexColor('#f3e5f5')), ('Lead', GREEN, GREEN_BG), ('File', RED, HexColor('#fee2e2'))]):
    chip(sx + 12 + i * 40, oy, 36, 14, l, col, bg)
oy -= 24
c.setFillColor(SLATE); c.setFont('Helvetica-Bold', 8); c.drawString(sx + 12, oy, 'Notes (optional)')
c.setFillColor(white); c.setStrokeColor(BORDER); c.roundRect(sx + 12, oy - 34, sw - 24, 28, 5, fill=1, stroke=1)
c.setFillColor(LGRAY); c.setFont('Helvetica', 8); c.drawString(sx + 18, oy - 20, 'Add call notes / next step...')
btn(sx + 12, oy - 44, (sw - 30) / 2, 20, 'Cancel', GRAY)
btn(sx + 18 + (sw - 30) / 2, oy - 44, (sw - 30) / 2, 20, 'Save', GREEN)
callout(px + 185, py + 250, W - (px + 185) - 18 * mm, 'Pick ONE outcome. "Connected" = you spoke to them.', point=(sx + 40, ct - 65))
callout(px + 185, py + 150, W - (px + 185) - 18 * mm, 'Set status to Follow Up (and a date) if they want a call back later.', point=(sx + 70, oy + 20))
callout(px + 185, py + 70, W - (px + 185) - 18 * mm, 'Tap SAVE — the call is only recorded after you save.', point=(sx + sw - 40, oy - 34))
ry = box(20 * mm, py - 6, W - 40 * mm, 0, 'IMPORTANT', 'ALWAYS complete and SAVE the Post-Call form after EVERY call. If you skip it, the call, outcome and follow-up are not saved and your numbers will be wrong.')
c.showPage()

# ============================================================ PAGE 4 — Files (create)
header_footer('4 • Files (Most Important)')
y = H - 22 * mm
y = h1(20 * mm, y, '4.  Files — creating a loan file')
ry = box(20 * mm, y - 6, W - 40 * mm, 0, 'IMPORTANT', 'If you already have a confirmed customer, create the File DIRECTLY from the Files page. You do NOT need to add them as a Lead first.')
para(20 * mm, ry, 'Path:  Files  →  Add New File  →  Customer Details  →  Type of Loan  →  Loan Amount  →  Create File', font='Helvetica-Bold', size=10.5, color=GREEN_D, max_w=W - 40 * mm)
px = 20 * mm; py = H - 250 * mm
sx, sy, sw, sh, ct = phone(px, py, 170, 300, 'Add New File')
fields = [('Full name', 'Full name'), ('Mobile', '10-digit mobile'), ('Email', 'email@example.com'), ('City', 'City'), ('Loan Amount Required', 'Amount')]
fy = ct - 14
for lab, ph in fields:
    c.setFillColor(SLATE); c.setFont('Helvetica-Bold', 7.5); c.drawString(sx + 12, fy, lab)
    c.setFillColor(white); c.setStrokeColor(BORDER); c.roundRect(sx + 12, fy - 20, sw - 24, 16, 4, fill=1, stroke=1)
    c.setFillColor(LGRAY); c.setFont('Helvetica', 7.5); c.drawString(sx + 17, fy - 15, ph)
    fy -= 30
# loan type dropdown highlighted
c.setFillColor(SLATE); c.setFont('Helvetica-Bold', 7.5); c.drawString(sx + 12, fy, 'Type of Loan')
c.setFillColor(GREEN_BG); c.setStrokeColor(GREEN); c.setLineWidth(1.2); c.roundRect(sx + 12, fy - 20, sw - 24, 16, 4, fill=1, stroke=1)
c.setFillColor(GREEN_D); c.setFont('Helvetica-Bold', 7.5); c.drawString(sx + 17, fy - 15, 'New Vehicle Loan            ▾')
fy -= 30
c.setFillColor(SLATE); c.setFont('Helvetica-Bold', 7.5); c.drawString(sx + 12, fy, 'Assign to Growth Partner')
chip(sx + 12, fy - 8, 46, 14, 'Myself', GREEN, GREEN_BG, active=True)
chip(sx + 62, fy - 8, 46, 14, 'Assign', GRAY, GRAY_BG)
btn(sx + 12, fy - 34, sw - 24, 20, 'Create File', GREEN)
callout(px + 185, py + 250, W - (px + 185) - 18 * mm, 'Tap Add New File on the Files page to open this form.', color=GREEN)
callout(px + 185, py + 150, W - (px + 185) - 18 * mm, 'Choose the CORRECT Type of Loan — it decides the required details, eligibility and (for Vehicle loans) the extra vehicle checks.', point=(sx + sw - 30, fy + 62), color=AMBER)
callout(px + 185, py + 55, W - (px + 185) - 18 * mm, 'Tap Create File to save.', point=(sx + sw/2, fy - 24), color=GREEN)
box(20 * mm, py - 6, W - 40 * mm, 0, 'TIP', 'Vehicle loans (New Vehicle Loan, Used Vehicle Loan (Fresh), Used Vehicle Loan BT) unlock extra vehicle sections in File Details — always pick the exact type.')
c.showPage()

# ============================================================ PAGE 5 — File Details
header_footer('5 • File Details')
y = H - 22 * mm
y = h1(20 * mm, y, '5.  File Details — read the full picture')
y -= 4
para(20 * mm, y, 'Tap any file to open File Details. Scroll to see every section. This is where you check the latest processing update.', max_w=W - 40 * mm)
px = 20 * mm; py = H - 250 * mm
sx, sy, sw, sh, ct = phone(px, py, 165, 300, 'File Details')
secs = [('👤 Customer Details', 'EDIT'), ('🎯 Loan Requirements', 'EDIT'), ('💼 Employment Details', 'EDIT'),
        ('📊 Profile Analysis', 'EDIT'), ('📊 Existing Loans', 'EDIT'), ('🏦 Bank Eligibilities', 'VIEW*'),
        ('📋 File Status', 'VIEW'), ('📜 Activity Log', 'VIEW')]
fy = ct - 16
for name, tag in secs:
    c.setFillColor(LIGHT); c.setStrokeColor(BORDER); c.roundRect(sx + 10, fy - 22, sw - 20, 20, 5, fill=1, stroke=1)
    c.setFillColor(DARK); c.setFont('Helvetica-Bold', 8.5); c.drawString(sx + 16, fy - 15, name)
    tcol = GREEN if tag.startswith('EDIT') else GRAY
    tbg = GREEN_BG if tag.startswith('EDIT') else GRAY_BG
    c.setFillColor(tbg); c.setStrokeColor(tcol); c.roundRect(sx + sw - 54, fy - 20, 40, 15, 7, fill=1, stroke=1)
    c.setFillColor(tcol); c.setFont('Helvetica-Bold', 7); c.drawCentredString(sx + sw - 34, fy - 15.5, tag)
    fy -= 27
btn(sx + 10, fy - 6, (sw - 26)/2, 18, 'Check Bank Eligibility', GREEN)
btn(sx + 16 + (sw - 26)/2, fy - 6, (sw - 26)/2, 18, 'Update Status', SLATE)
ex = px + 180; ey = H - 34 * mm; ew = W - ex - 18 * mm
c.setFillColor(DARK); c.setFont('Helvetica-Bold', 11); c.drawString(ex, ey, 'You can EDIT'); ey -= 15
for t in ['Customer Details, Loan Requirements (type/amount), Employment, Profile Analysis (CIBIL Issues, FOIR %, Company Type), Existing Loans.']:
    ey = bullet(ex, ey, t, size=9.5, max_w=ew, dot=GREEN)
ey -= 2
c.setFillColor(DARK); c.setFont('Helvetica-Bold', 11); c.drawString(ex, ey, 'View only (updated by Ops/Bank team)'); ey -= 15
for t in ['Bank Eligibilities, Login info, Approval info, Document/processing info, Disbursement, Commission/Earnings, Activity Log.',
          'Vehicle loans also show TVR/EMI pre-verification, RC / NOC / Hypothecation checks and vehicle eligibility.',
          '*You add banks via "Check Bank Eligibility"; the login/approval/disbursal results are filled by the processing team.']:
    ey = bullet(ex, ey, t, size=9.5, max_w=ew, dot=GRAY)
ey = box(ex, ey - 2, ew, 0, 'TIP', 'Check File Details FIRST for the latest Login / Approval / Disbursement update instead of asking Ops for something already in the app.')
c.showPage()

# ============================================================ PAGE 6 — File Status flow + table
header_footer('6 • File Status')
y = H - 22 * mm
y = h1(20 * mm, y, '6.  How to read File Status')
y -= 6
# flow
steps = ['FILE', 'LOGIN', 'APPROVED', 'DISBURSED']
fx = 22 * mm; bw = 34 * mm; gap = 8 * mm
for i, s in enumerate(steps):
    xx = fx + i * (bw + gap)
    c.setFillColor(GREEN if i < 3 else GREEN_D); c.roundRect(xx, y - 22, bw, 22, 6, fill=1, stroke=0)
    c.setFillColor(white); c.setFont('Helvetica-Bold', 11); c.drawCentredString(xx + bw/2, y - 15, s)
    if i < 3:
        c.setStrokeColor(GREEN); c.setLineWidth(2); ax = xx + bw + 1; c.line(ax, y - 11, ax + gap - 2, y - 11)
        c.setFillColor(GREEN)
        c.line(ax + gap - 5, y - 8, ax + gap - 2, y - 11); c.line(ax + gap - 5, y - 14, ax + gap - 2, y - 11)
y -= 34
para(20 * mm, y, 'A healthy file moves left to right. Some files also show interim/negative statuses — here is what each means and what to do.', max_w=W - 40 * mm)
y -= 6
# table
rows = [
    ('Status', 'What it means', 'What you should do'),
    ('New / Contacted', 'File just created / first contact done', 'Collect documents & basic details'),
    ('Documents Collected', 'Customer documents received', 'Run Check Bank Eligibility'),
    ('Sent to Bank', 'File submitted to a bank', 'Wait for login; keep customer informed'),
    ('Login', 'Bank has logged in the case', 'Track for approval; upload pending docs'),
    ('Not Login', 'Bank did not log in the case', 'Fix reason / try another eligible bank'),
    ('Approved', 'Bank approved the loan', 'Share approval; complete disbursal steps'),
    ('Declined / Rejected', 'Bank rejected the case', 'Check reason; try another bank if eligible'),
    ('Disbursed', 'Loan amount paid out', 'Done — your commission is recorded'),
    ('Not Disbursed', 'Approved but not paid yet', 'Complete pending steps for disbursal'),
]
tx = 20 * mm; tw = W - 40 * mm
c1, c2, c3 = tw * 0.26, tw * 0.40, tw * 0.34
rh = 15
for r, (a, b, cc) in enumerate(rows):
    ry = y - r * rh
    if r == 0:
        c.setFillColor(DARK); c.rect(tx, ry - rh, tw, rh, fill=1, stroke=0); tcol = white; fnt = 'Helvetica-Bold'
    else:
        c.setFillColor(LIGHT if r % 2 else white); c.rect(tx, ry - rh, tw, rh, fill=1, stroke=0); tcol = SLATE; fnt = 'Helvetica'
    c.setStrokeColor(BORDER); c.setLineWidth(0.4); c.rect(tx, ry - rh, tw, rh, fill=0, stroke=1)
    c.setFillColor(DARK if r == 0 else GREEN_D); c.setFont('Helvetica-Bold', 8); c.drawString(tx + 4, ry - rh + 4.5, a)
    c.setFillColor(tcol); c.setFont(fnt, 8); c.drawString(tx + c1 + 4, ry - rh + 4.5, b)
    c.drawString(tx + c1 + c2 + 4, ry - rh + 4.5, cc)
y2 = y - len(rows) * rh - 10
box(20 * mm, y2, W - 40 * mm, 0, 'TIP', 'Interim reject = a temporary hold/objection you can still fix. Final reject = the bank has closed the case. Read the reason in Activity Log.')
c.showPage()

# ============================================================ PAGE 7 — Eligibility + Meta
header_footer('7 • Eligibility & Meta')
y = H - 22 * mm
y = h1(20 * mm, y, '7.  Eligibility')
y -= 4
para(20 * mm, y, 'From File Details tap Check Bank Eligibility to open the Bank Eligibility Analysis. It shows the customer profile and which banks the file is eligible for.', max_w=W - 40 * mm)
px = 20 * mm; py = H - 175 * mm
sx, sy, sw, sh, ct = phone(px, py, 160, 225, 'Bank Eligibility Analysis')
c.setFillColor(DARK); c.setFont('Helvetica-Bold', 9); c.drawString(sx + 12, ct - 16, 'Customer Profile')
c.setFillColor(LIGHT); c.roundRect(sx + 12, ct - 58, sw - 24, 38, 5, fill=1, stroke=0)
rowline(sx + 20, ct - 32, sw - 40, 'Loan Type', 'Used Vehicle Loan BT')
rowline(sx + 20, ct - 44, sw - 40, 'Employment', 'Salaried')
rowline(sx + 20, ct - 56, sw - 40, 'FOIR %', '42%')
c.setFillColor(DARK); c.setFont('Helvetica-Bold', 9); c.drawString(sx + 12, ct - 78, 'Banks')
for i, (bk, ok) in enumerate([('HDFC Bank', True), ('ICICI Bank', True), ('Axis Bank', False)]):
    by = ct - 94 - i * 24
    c.setFillColor(white); c.setStrokeColor(BORDER); c.roundRect(sx + 12, by - 18, sw - 24, 18, 5, fill=1, stroke=1)
    c.setFillColor(DARK); c.setFont('Helvetica-Bold', 8); c.drawString(sx + 18, by - 12, bk)
    col = GREEN if ok else RED; bg = GREEN_BG if ok else HexColor('#fee2e2')
    lab = 'Eligible' if ok else 'Not Eligible'
    c.setFillColor(bg); c.setStrokeColor(col); c.roundRect(sx + sw - 60, by - 16, 46, 14, 7, fill=1, stroke=1)
    c.setFillColor(col); c.setFont('Helvetica-Bold', 7.5); c.drawCentredString(sx + sw - 37, by - 11.5, lab)
ex = px + 175; ey = H - 44 * mm; ew = W - ex - 18 * mm
for t in ['Green = Eligible, Red = Not Eligible for that bank.',
          'The list is based on the customer profile & loan type you entered.',
          'For vehicle loans, vehicle-specific rules are included in the check.',
          'Previous Checks / History let you re-open earlier eligibility results.']:
    ey = bullet(ex, ey, t, size=9.5, max_w=ew)
# Meta
my = py - 8
my = h1(20 * mm, my, '8.  Meta (only if enabled for you)')
para(20 * mm, my, 'If the Meta tab is visible, you have Meta access. Meta leads work just like normal leads:', max_w=W - 40 * mm)
mflow = ['Meta Lead', 'Call', 'Outcome', 'File']
fx = 24 * mm
for i, s in enumerate(mflow):
    xx = fx + i * 42 * mm
    c.setFillColor(PURPLE); c.roundRect(xx, my - 40, 34 * mm, 18, 6, fill=1, stroke=0)
    c.setFillColor(white); c.setFont('Helvetica-Bold', 9); c.drawCentredString(xx + 17 * mm, my - 32, s)
    if i < 3:
        c.setStrokeColor(PURPLE); c.setLineWidth(2); c.line(xx + 34 * mm, my - 31, xx + 42 * mm, my - 31)
box(20 * mm, my - 50, W - 40 * mm, 0, 'TIP', 'No Meta tab? That simply means Meta access is not enabled for your account — everything else still works normally.')
c.showPage()

# ============================================================ PAGE 8 — Reports/Earnings + Attendance
header_footer('9 • Reports, Earnings & Attendance')
y = H - 22 * mm
y = h1(20 * mm, y, '9.  Stats, Reports & Earnings')
y -= 4
para(20 * mm, y, 'Your Dashboard already shows most numbers. Use the month toggle to see a specific month. Watch these to track your income:', max_w=W - 40 * mm)
y -= 4
cards = [('Files', 'Files you own', ORANGE, HexColor('#fff3e0')),
         ('Login', 'Cases logged in by banks', BLUE, BLUE_BG),
         ('Approved', 'Cases approved', GREEN, GREEN_BG),
         ('Disbursed', 'Loans paid out', GREEN_D, GREEN_BG),
         ('Earnings', 'Your commission', HexColor('#7c3aed'), HexColor('#ede9fe'))]
cx = 20 * mm; cw = (W - 40 * mm - 4 * 4 * mm) / 5
for i, (t, d, col, bg) in enumerate(cards):
    xx = cx + i * (cw + 4 * mm)
    c.setFillColor(bg); c.setStrokeColor(col); c.roundRect(xx, y - 40, cw, 38, 6, fill=1, stroke=1)
    c.setFillColor(col); c.setFont('Helvetica-Bold', 11); c.drawCentredString(xx + cw/2, y - 18, t)
    c.setFillColor(SLATE); c.setFont('Helvetica', 7)
    for j, ln in enumerate(wrap(d, 'Helvetica', 7, cw - 8)):
        c.drawCentredString(xx + cw/2, y - 28 - j * 8, ln)
y -= 52
para(20 * mm, y, 'Commission is recorded when a file reaches Disbursed. Always keep files moving to disbursal — that is what pays you.', font='Helvetica-Bold', color=GREEN_D, max_w=W - 40 * mm)
y -= 10
y = h1(20 * mm, y, '10.  Attendance (Check In / Check Out)')
para(20 * mm, y, 'Open More → Attendance. Tap Check In when you start and Check Out when you finish. Choose WFH if you are working from home; the app may capture your location for office attendance.', max_w=W - 40 * mm)
px = 20 * mm; py = H - 250 * mm
sx, sy, sw, sh, ct = phone(px, py, 155, 150, 'My Attendance')
c.setFillColor(SLATE); c.setFont('Helvetica', 8); c.drawCentredString(sx + sw/2, ct - 18, 'Today')
btn(sx + 16, ct - 34, sw - 32, 22, 'Check In', GREEN)
btn(sx + 16, ct - 62, sw - 32, 22, 'Check Out', SLATE)
chip(sx + sw/2 - 24, ct - 78, 48, 15, 'WFH', BLUE, BLUE_BG)
c.setFillColor(GRAY); c.setFont('Helvetica', 7.5); c.drawCentredString(sx + sw/2, ct - 100, 'Attendance Rate: 96%')
callout(px + 170, py + 120, W - (px + 170) - 18 * mm, 'Tap Check In at the start of your day.', point=(sx + sw - 20, ct - 30))
callout(px + 170, py + 55, W - (px + 170) - 18 * mm, 'Tap Check Out when you finish. Use WFH if working from home.', point=(sx + sw - 20, ct - 58))
c.showPage()

# ============================================================ FINAL — Golden Rules
header_footer('Golden Rules')
c.setFillColor(DARK); c.rect(0, H - 46 * mm, W, 34 * mm, fill=1, stroke=0)
c.setFillColor(GREEN); c.setFont('Helvetica-Bold', 22); c.drawCentredString(W/2, H - 30 * mm, '7 GOLDEN RULES')
c.setFillColor(HexColor('#a7f3d0')); c.setFont('Helvetica', 11)
c.drawCentredString(W/2, H - 38 * mm, 'Follow these every day to grow your earnings')
rules = [
    'Always log and SAVE the outcome after EVERY call.',
    'Set follow-ups correctly (with a date) so no customer is forgotten.',
    'Select the CORRECT loan type on every file.',
    'Create confirmed customers as Files directly from the Files page.',
    'Check File Details regularly for Login / Approval / Disbursement updates.',
    'Check the app before asking Ops for a status already shown in the app.',
    'Never share your BankEzee Connect login with anyone.',
]
ry = H - 60 * mm
for i, r in enumerate(rules):
    c.setFillColor(GREEN); c.circle(28 * mm, ry + 4, 9, fill=1, stroke=0)
    c.setFillColor(white); c.setFont('Helvetica-Bold', 12); c.drawCentredString(28 * mm, ry + 0.5, str(i + 1))
    c.setFillColor(DARK); c.setFont('Helvetica-Bold', 12.5)
    lines = wrap(r, 'Helvetica-Bold', 12.5, W - 40 * mm - 20 * mm)
    yy = ry + 4
    for ln in lines:
        c.drawString(38 * mm, yy - 4, ln); yy -= 15
    ry -= 20 * mm if len(lines) > 1 else 16 * mm
c.setFillColor(GREEN); c.roundRect(20 * mm, 24 * mm, W - 40 * mm, 16 * mm, 8, fill=1, stroke=0)
c.setFillColor(white); c.setFont('Helvetica-Bold', 13)
c.drawCentredString(W/2, 30 * mm, 'More calls  →  more files  →  more disbursals  →  more earnings')
c.showPage()

c.save()
print('PDF written: /app/BankEzee_Connect_Mobile_Manual_v2.7.1.pdf')
