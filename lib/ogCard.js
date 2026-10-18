// Layout of the 1200x630 preview cards. Plain objects (no JSX) so it can be rendered and tested anywhere.
import { strings as s } from './strings.js';

const INK = '#0e1f17', PAPER = '#f6f4ec', GOLD = '#f2b705', MUTED = '#4a5c52';
const h = (type, props, ...kids) => ({ type, props: { ...props, children: kids.length === 0 ? undefined : kids.length === 1 ? kids[0] : kids } });
const COLORS = { reported: '#8a948e', verified: INK, sent: GOLD, in_progress: GOLD, resolved: '#1f8a57' };

const stripe = () => h('div', { style: { display: 'flex', height: 14 } },
  h('div', { style: { flex: 1, background: '#c8382b' } }), h('div', { style: { flex: 1, background: GOLD } }), h('div', { style: { flex: 1, background: '#1f8a57' } }));
const brand = () => h('div', { style: { display: 'flex', alignItems: 'center', fontSize: 34, fontWeight: 800 } },
  h('div', { style: { display: 'flex', width: 44, height: 44, borderRadius: 22, background: GOLD, marginRight: 14 } }), 'CivicPulse');
const tagline = () => h('div', { style: { display: 'flex', fontSize: 26, color: MUTED } }, 'Your street. Your voice. Their response, in public.');
const rings = () => h('div', { style: { display: 'flex', width: 480, background: INK, alignItems: 'center', justifyContent: 'center' } },
  h('div', { style: { display: 'flex', width: 340, height: 340, borderRadius: 170, border: '3px solid #5a4a0a', alignItems: 'center', justifyContent: 'center' } },
    h('div', { style: { display: 'flex', width: 220, height: 220, borderRadius: 110, border: '3px solid #8f7408', alignItems: 'center', justifyContent: 'center' } },
      h('div', { style: { display: 'flex', width: 110, height: 110, borderRadius: 55, background: GOLD } }))));
const frame = (left, right) => h('div', { style: { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: PAPER, color: INK, fontFamily: 'Jakarta' } },
  stripe(), h('div', { style: { display: 'flex', flex: 1 } }, left, right));
const leftCol = (...kids) => h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1, padding: '44px 56px' } }, ...kids);

export function brandCard() {
  return frame(leftCol(brand(),
    h('div', { style: { display: 'flex', fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 } }, 'Your street. Your voice. Their response, in public.'),
    h('div', { style: { display: 'flex', fontSize: 28, color: MUTED } }, 'Report it. Watch it get fixed. See who fixed it.')), rings());
}

export function reportCard(d) {
  const status = s.statusLabels[d.status] ?? d.status;
  const line = d.status === 'resolved'
    ? s.share.fixed(d.days_open)
    : `${s.daysOpen(d.days_open)} · ${s.confirmations(d.confirmation_count)}`;
  const chipBg = COLORS[d.status] ?? INK;
  const photo = d.photo
    ? h('div', { style: { display: 'flex', width: 480, padding: '40px 40px 40px 0' } },
        h('img', { src: d.photo, width: 440, height: 530, style: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 32 } }))
    : rings();
  return frame(leftCol(brand(),
    h('div', { style: { display: 'flex', flexDirection: 'column' } },
      h('div', { style: { display: 'flex', alignSelf: 'flex-start', padding: '8px 22px', borderRadius: 99, fontSize: 28, fontWeight: 800, background: chipBg, color: d.status === 'sent' || d.status === 'in_progress' ? INK : '#fff' } }, status),
      h('div', { style: { display: 'flex', fontSize: 70, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, marginTop: 22 } }, d.category),
      h('div', { style: { display: 'flex', fontSize: 34, color: MUTED, marginTop: 16 } }, line),
      d.party ? h('div', { style: { display: 'flex', fontSize: 28, marginTop: 10 } }, `${s.responsibleParty}: ${d.party}`) : h('div', { style: { display: 'flex' } }, '')),
    tagline()), photo);
}
