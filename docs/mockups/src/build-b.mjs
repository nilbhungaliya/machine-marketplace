// Builds docs/mockups/user-app-mockup-b.html: design direction B ("workshop enamel") for client review.
// Same flows, screens and content as build.mjs (direction A), so the two can be compared like for like; the side
// mark, home header, listing tiles and all styling differ.
// Run from the repo root:  node docs/mockups/src/build-b.mjs
// Static output, no runtime dependencies besides Google Fonts.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../user-app-mockup-b.html', import.meta.url));

// ─── icons (stroke sprite) ──────────────────────────────────────────────────
const ICONS = {
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  plus: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  deal: '<path d="M3 12h4l3-3 4 1 3 3h4"/><path d="m7 12 4 4c.8.8 2 .8 2.8 0L17 13"/><path d="M3 8v8M21 8v8"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  pin: '<path d="M12 21s-7-6.3-7-11.5A7 7 0 0 1 19 9.5C19 14.7 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  shield: '<path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/>',
  phone: '<path d="M6 3h4l1.5 5-2.5 1.5a11 11 0 0 0 5.5 5.5L16 12.5l5 1.5v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m5 9 7 7 7-7"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/>',
  flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  rupee: '<path d="M7 4h10M7 8h10M7 4c5 0 7 2 7 4s-2 4-7 4l7 8"/>',
  map: '<path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  logout: '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.3 3.5 5.2 3.5 8.5s-1 6.2-3.5 8.5c-2.5-2.3-3.5-5.2-3.5-8.5s1-6.2 3.5-8.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L11 20a2.1 2.1 0 0 1-3-3l8.5-8.5"/><path d="M14.5 6.5 17 4"/>',
  truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
};

// Line drawings of parts and machines, drawn on a blueprint grid in thumbnails.
const PARTS = {
  gear: '<circle cx="50" cy="50" r="22"/><circle cx="50" cy="50" r="8"/><path d="M50 18v8M50 74v8M18 50h8M74 50h8M27 27l6 6M67 67l6 6M27 73l6-6M67 33l6-6"/>',
  bearing: '<circle cx="50" cy="50" r="28"/><circle cx="50" cy="50" r="14"/><circle cx="50" cy="29" r="4"/><circle cx="50" cy="71" r="4"/><circle cx="29" cy="50" r="4"/><circle cx="71" cy="50" r="4"/><circle cx="35" cy="35" r="4"/><circle cx="65" cy="65" r="4"/><circle cx="35" cy="65" r="4"/><circle cx="65" cy="35" r="4"/>',
  cylinder: '<rect x="16" y="40" width="48" height="20" rx="3"/><path d="M64 50h22M86 44v12"/><path d="M16 46h-6v8h6"/><path d="M28 40v20M52 40v20"/>',
  motor: '<rect x="20" y="32" width="44" height="36" rx="6"/><path d="M64 44h10v12H64M74 50h12"/><path d="M28 32v36M36 32v36M44 32v36M52 32v36"/><path d="M24 68v8h36v-8"/>',
  bracketL: '<path d="M26 22h16v40h32v16H26z"/><circle cx="34" cy="32" r="3"/><circle cx="64" cy="70" r="3"/>',
  bracketR: '<path d="M74 22H58v40H26v16h48z"/><circle cx="66" cy="32" r="3"/><circle cx="36" cy="70" r="3"/>',
  lathe: '<rect x="12" y="58" width="76" height="10" rx="2"/><rect x="14" y="36" width="20" height="22" rx="2"/><path d="M34 47h30"/><rect x="64" y="40" width="14" height="18" rx="2"/><path d="M20 68v12M80 68v12"/><circle cx="24" cy="47" r="5"/>',
  press: '<path d="M24 82V22h52v60"/><path d="M24 36h52"/><rect x="40" y="40" width="20" height="18"/><path d="M50 58v8M34 72h32"/><path d="M18 82h64"/>',
  excavator: '<rect x="20" y="58" width="44" height="12" rx="6"/><rect x="28" y="40" width="24" height="18" rx="2"/><path d="M52 46l18-14 12 14-6 10"/><path d="M82 46l-6 10h-8"/><circle cx="27" cy="64" r="3"/><circle cx="57" cy="64" r="3"/>',
  chain: '<rect x="14" y="40" width="22" height="20" rx="10"/><rect x="30" y="40" width="22" height="20" rx="10"/><rect x="46" y="40" width="22" height="20" rx="10"/><rect x="62" y="40" width="22" height="20" rx="10"/>',
  hub: '<circle cx="50" cy="50" r="26"/><circle cx="50" cy="50" r="10"/><circle cx="50" cy="32" r="3"/><circle cx="66" cy="56" r="3"/><circle cx="34" cy="56" r="3"/>',
  forklift: '<path d="M22 70V44h22l8 12v14"/><path d="M60 30v44M60 70h20"/><circle cx="30" cy="72" r="5"/><circle cx="48" cy="72" r="5"/><path d="M28 44V32h12"/>',
};

const sprite = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
${Object.entries(ICONS).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('\n')}
${Object.entries(PARTS).map(([k, v]) => `<symbol id="p-${k}" viewBox="0 0 100 100">${v}</symbol>`).join('\n')}
</defs></svg>`;

const ic = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const thumb = (part, cls = '') => `<div class="thumb ${cls}"><svg aria-hidden="true"><use href="#p-${part}"/></svg></div>`;

// The signature element: an L | R token. Filled = the listing has that side, orange dashed = the side someone needs,
// grey = the side they already have, faint dashed = not part of this listing.
function side(kind, { label = true, size = '' } = {}) {
  const names = { left: 'Left', right: 'Right', pair: 'Pair', 'want-left': 'Needs left', 'want-right': 'Needs right' };
  const cls = (s, other) => (kind === s || kind === 'pair' ? 'on' : kind === `want-${s}` ? 'need' : kind === `want-${other}` ? 'have' : 'off');
  return `<span class="side ${size}" title="${names[kind]}"><span class="sd" aria-hidden="true"><i class="${cls('left', 'right')}">L</i><i class="${cls('right', 'left')}">R</i></span>${label ? `<span>${names[kind]}</span>` : ''}</span>`;
}

// ─── phone chrome ───────────────────────────────────────────────────────────
const TABS = [
  ['home', 'Home', 'home'], ['search', 'Browse', 'search'], ['sell', 'Sell', 'plus'],
  ['chats', 'Enquiries', 'chat'], ['deals', 'Deals', 'deal'],
];
function tabbar(active) {
  if (!active) return '';
  return `<nav class="tabbar">${TABS.map(([k, label, icon]) =>
    `<span class="tab ${k === active ? 'on' : ''} ${k === 'sell' ? 'sell' : ''}">${ic(icon)}<b>${label}</b></span>`).join('')}</nav>`;
}
function appbar(title, { back = true, right = '', sub = '' } = {}) {
  return `<header class="appbar">${back ? `<span class="iconbtn">${ic('back')}</span>` : ''}
    <div class="appbar-t"><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}</div>${right}</header>`;
}
const status = `<div class="statusbar"><b>9:41</b><span class="sb-r"><i></i><i></i><i></i><em></em></span></div>`;

let screenNo = 0;
let flowNo = 0;
function phone(caption, body, { tab = null, note = '', overlay = '', cls = '' } = {}) {
  screenNo += 1;
  return `<figure class="shot">
  <div class="phone ${cls}">${status}<div class="screen">${body}</div>${tabbar(tab)}${overlay}</div>
  <figcaption><span class="num">${flowNo}.${screenNo}</span><span><b>${caption}</b>${note ? `<small>${note}</small>` : ''}</span></figcaption>
</figure>`;
}
function flow(id, title, scope, intro, phones) {
  flowNo += 1;
  screenNo = 0;
  const body = phones().join('');
  return `<section class="flow" id="${id}">
  <div class="flow-head"><h2><span class="fn">${flowNo}</span>${title}</h2><p class="scope">${scope}</p><p>${intro}</p></div>
  <div class="shots">${body}</div>
</section>`;
}

// ─── shared pieces ──────────────────────────────────────────────────────────
const verified = `<span class="badge ok">${ic('shield')}GST verified</span>`;
function listing({ part, title, sideKind = null, cond, qty, price, place, dist = '', tag = '', compat = '', fits = 'Fits' }) {
  return `<article class="listing ${tag ? 'has-tag' : ''}">
    ${thumb(part)}
    <div class="l-body">
      <h4>${title}</h4>
      ${compat ? `<p class="compat">${fits} ${compat}</p>` : ''}
      <div class="l-tags">${sideKind ? side(sideKind) : ''}<span class="cond">${cond}</span><span class="qty">${qty}</span></div>
      <div class="l-foot"><span class="price">${price}</span><span class="place">${ic('pin')}${place}${dist ? ` <em>${dist}</em>` : ''}</span></div>
      ${tag ? `<span class="ltag">${tag}</span>` : ''}
    </div>
  </article>`;
}
const field = (label, value, { hint = '', empty = false, suffix = '', cls = '' } = {}) =>
  `<label class="field ${cls}"><span class="f-l">${label}</span><span class="f-v ${empty ? 'empty' : ''}">${value}${suffix ? `<em>${suffix}</em>` : ''}</span>${hint ? `<span class="f-h">${hint}</span>` : ''}</label>`;
const chips = (items, on = []) => `<div class="chips">${items.map((c) => `<span class="chip ${on.includes(c) ? 'on' : ''}">${c}</span>`).join('')}</div>`;
const btn = (label, kind = 'primary', icon = '') => `<span class="btn ${kind}">${icon ? ic(icon) : ''}${label}</span>`;
const steps = (n, total, label) => `<div class="steps"><div class="steps-bar">${Array.from({ length: total }, (_, i) => `<i class="${i < n ? 'fill' : ''}"></i>`).join('')}</div><span>Step ${n} of ${total}: ${label}</span></div>`;
const footer = (inner) => `<div class="footbar">${inner}</div>`;
const sheet = (title, inner) => `<div class="scrim"></div><div class="sheet"><div class="grab"></div><h3>${title}</h3>${inner}</div>`;
const specs = (rows) => `<dl class="specs">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;

// ─── flows ──────────────────────────────────────────────────────────────────
const flows = [];

flows.push(flow('onboarding', 'Sign in and business profile', 'Scope U1, U2, F1',
  'Guests browse freely. The phone number is asked for at the first action (enquire, offer, sell, save), then a short business profile with location and industrial area. GST verification is offered, not forced, and unlocks the verified badge.',
  () => [
    phone('Welcome', `<div class="welcome">
        <div class="w-art">${thumb('gear', 'big')}${side('want-right', { size: 'xl', label: false })}</div>
        <h1>Find the part your machine is missing</h1>
        <p>Spare parts and machinery from verified businesses near you. Got only the left side? We find the right one.</p>
        ${btn('Continue with mobile number')}
        <span class="link">Browse without signing in</span>
        <span class="lang">${ic('globe')}English, हिन्दी, ગુજરાતી</span>
      </div>`),
    phone('Mobile number', `${appbar('')}<div class="pad">
        <h1 class="h1">Your mobile number</h1><p class="lead">We send a 6-digit code by SMS.</p>
        <div class="phonefield"><span>+91</span><b>98250 41736</b></div>
        <p class="fine">Buyers see your number only after you share it in a chat.</p>
      </div>${footer(btn('Send code'))}`, { note: 'Asked at the first action, not at app open' }),
    phone('Code', `${appbar('')}<div class="pad">
        <h1 class="h1">Enter the code</h1><p class="lead">Sent to +91 98250 41736</p>
        <div class="otp"><i>4</i><i>8</i><i>1</i><i>9</i><i class="cur"></i><i></i></div>
        <p class="fine">Resend in 24 s</p>
      </div>${footer(btn('Verify'))}`),
    phone('Business profile', `${appbar('Your business')}<div class="pad form">
        ${field('Your name', 'Hitesh Patel')}
        ${field('Business name', 'Shree Ambica Engineering')}
        <div class="field"><span class="f-l">What will you do here?</span>${chips(['Buy parts', 'Sell parts', 'Rent out machines'], ['Buy parts', 'Sell parts'])}<span class="f-h">One account can buy and sell. Change it any time.</span></div>
        <div class="field"><span class="f-l">Machines you work with</span>${chips(['CNC & lathes', 'Earthmoving', 'Textile', 'Plastic moulding', 'Printing', 'Tractors'], ['CNC & lathes', 'Earthmoving'])}</div>
      </div>${footer(btn('Next'))}`),
    phone('Location and industrial area', `${appbar('Where are you?')}<div class="pad form">
        <div class="mapbox">${ic('pin', 'mappin')}<span>Aji GIDC, Rajkot</span></div>
        ${btn('Use my current location', 'ghost', 'pin')}
        ${field('Industrial area', 'Aji GIDC, Phase 2', { hint: 'Buyers search by industrial area' })}
        ${field('City', 'Rajkot')}
        ${field('State', 'Gujarat')}
        ${field('Pincode', '360003')}
      </div>${footer(btn('Save location'))}`, { note: 'Powers “near you” and region search (F5)' }),
    phone('GST verification', `${appbar('Get verified')}<div class="pad form">
        <div class="callout">${ic('shield')}<p><b>Verified businesses get 3× more enquiries.</b> We check your GSTIN with the GST network. It is free.</p></div>
        ${field('GSTIN', '24AAKFS4821M1Z6')}
        <div class="gstcard"><h4>Shree Ambica Engineering</h4><p>Partnership firm, active since 2011</p><p>Plot 214, Aji GIDC, Rajkot, Gujarat</p><span class="badge ok">${ic('check')}Matches your profile</span></div>
        <p class="fine">An admin reviews it within one working day. You can list and buy meanwhile.</p>
      </div>${footer(`${btn('Skip for now', 'ghost')}${btn('Submit for review')}`)}`),
  ]));

flows.push(flow('discover', 'Home, browse and search', 'Scope U2, F3, F4, F5',
  'Home opens on what is near the buyer. Browsing follows the admin-managed tree (machine category, machine type, part). Search covers part name, machine, brand, model and part number; the side filter and the complementary-part strip are what set this market apart.',
  () => [
    phone('Home', `<div class="homehead"><div class="home-top">
        <div class="loc">${ic('pin')}<span><b>Aji GIDC, Rajkot</b><small>Within 25 km</small></span>${ic('down')}</div>
        <span class="iconbtn">${ic('bell')}<i class="dot"></i></span>
      </div>
      <div class="searchbar">${ic('search')}<span>Part, machine, brand or part no.</span></div></div>
      <div class="cats">
        ${[['gear', 'Spare parts'], ['lathe', 'Machinery'], ['excavator', 'For rent'], ['motor', 'Electrical'], ['cylinder', 'Hydraulics'], ['bearing', 'Bearings']].map(([p, n]) => `<span class="cat">${thumb(p, 'sm')}<b>${n}</b></span>`).join('')}
      </div>
      <div class="sidematch">
        ${side('want-right', { label: false, size: 'lg' })}
        <div><b>2 right-side matches for your left tie rod end</b><small>From your part request, 6 km and 18 km away</small></div>${ic('chevron')}
      </div>
      <h2 class="sec">Near you</h2>
      <div class="lgrid">${listing({ part: 'cylinder', title: 'Hydraulic boom cylinder', compat: 'JCB 3DX (2015–2021)', cond: 'Used', qty: '2 pcs', price: '₹38,500', place: 'Shapar, Rajkot', dist: '9 km' })}
      ${listing({ part: 'bracketL', title: 'Mudguard bracket', compat: 'Mahindra 575 DI', sideKind: 'left', cond: 'Unused', qty: '14 pcs', price: '₹420 /pc', place: 'Aji GIDC', dist: '2 km' })}</div>
      <h2 class="sec">Machines for rent nearby</h2>
      <div class="hscroll">
        <div class="mini">${thumb('excavator')}<b>JCB 3DX backhoe</b><span>₹1,400 /hour</span></div>
        <div class="mini">${thumb('forklift')}<b>Forklift 3 T</b><span>₹2,600 /day</span></div>
      </div>`, { tab: 'home' }),
    phone('Browse by machine', `${appbar('Browse', { back: false })}
      <div class="crumbs"><span>Earthmoving</span>${ic('chevron')}<span>Backhoe loaders</span>${ic('chevron')}<b>Parts</b></div>
      <div class="tree">
        ${[['Hydraulics', 128], ['Transmission & axles', 96], ['Engine parts', 211], ['Cabin & body', 64], ['Steering & linkages', 57], ['Electrical', 83], ['Undercarriage', 40], ['Filters', 152]].map(([n, c]) => `<div class="tree-row"><span>${n}</span><em>${c}</em>${ic('chevron')}</div>`).join('')}
      </div>
      <h2 class="sec">Popular brands here</h2>
      ${chips(['JCB', 'Tata Hitachi', 'CAT', 'Mahindra EarthMaster', 'ACE', 'Case'])}`, { tab: 'search' }),
    phone('Search results', `<div class="searchtop">
        <span class="iconbtn">${ic('back')}</span><div class="searchbar in">${ic('search')}<b>tie rod end tata 1613</b></div>
      </div>
      <div class="filterrow"><span class="chip on">${ic('filter')}Filters 3</span><span class="chip on">Right side</span><span class="chip on">Within 50 km</span><span class="chip">Used</span><span class="chip">Price</span></div>
      <p class="count">14 results, nearest first</p>
      ${listing({ part: 'bracketR', title: 'Tie rod end, outer', compat: 'Tata LPT 1613, 1618', sideKind: 'right', cond: 'New', qty: '6 pcs', price: '₹1,150 /pc', place: 'Bhaktinagar, Rajkot', dist: '6 km' })}
      ${listing({ part: 'bracketR', title: 'Tie rod end assembly', compat: 'Tata LPT 1613', sideKind: 'right', cond: 'Used', qty: '1 pc', price: 'Price on request', place: 'Gondal', dist: '18 km' })}
      ${listing({ part: 'bracketL', title: 'Tie rod end pair, OEM', compat: 'Tata LPT 1613, 2518', sideKind: 'pair', cond: 'Excess', qty: '3 pairs', price: '₹2,050 /pair', place: 'Morbi', dist: '41 km', tag: 'Pair' })}`, { tab: 'search', note: 'Side is a filter, not a keyword' }),
    phone('Filters', `${appbar('Filters', { back: false, right: '<span class="link sm">Clear all</span>' })}
      <div class="pad form filters">
        <div class="field"><span class="f-l">Side</span><div class="sidepick">${['left', 'right', 'pair'].map((k) => `<span class="sp ${k === 'right' ? 'on' : ''}">${side(k)}</span>`).join('')}</div></div>
        <div class="field"><span class="f-l">Condition</span>${chips(['New', 'Used', 'Unused', 'Excess'], ['New', 'Used'])}</div>
        <div class="field"><span class="f-l">Fits machine</span><span class="f-v">Tata LPT 1613</span></div>
        <div class="field"><span class="f-l">Distance</span><div class="range"><i style="width:38%"></i><b style="left:38%"></b></div><span class="f-h">Within 50 km of Aji GIDC</span></div>
        <div class="field"><span class="f-l">Price per unit</span><div class="two">${field('Min', '₹500')}${field('Max', '₹3,000')}</div></div>
        <div class="field"><span class="f-l">Quantity available</span>${chips(['Any', '2+', '10+', '50+'], ['Any'])}</div>
        <div class="field"><span class="f-l">Seller</span>${chips(['GST verified only', 'Has video'], ['GST verified only'])}</div>
      </div>${footer(btn('Show 14 results'))}`),
    phone('Near me', `${appbar('Stock near you', { back: true, right: `<span class="iconbtn">${ic('grid')}</span>` })}
      <div class="bigmap">
        <span class="pinm me">${ic('user')}</span>
        <span class="pinm" style="left:22%;top:30%">12</span><span class="pinm" style="left:64%;top:22%">5</span>
        <span class="pinm" style="left:70%;top:62%">31</span><span class="pinm" style="left:30%;top:70%">8</span>
        <span class="maplabel" style="left:52%;top:80%">Shapar-Veraval</span><span class="maplabel" style="left:12%;top:22%">Aji GIDC</span>
      </div>
      <div class="pad"><div class="segmented"><span class="on">City</span><span>Industrial area</span><span>State</span></div>
      <div class="arealist">
        <div><b>Shapar-Veraval</b><span>31 parts, 4 machines for rent</span><em>14 km</em></div>
        <div><b>Aji GIDC</b><span>12 parts</span><em>2 km</em></div>
        <div><b>Metoda GIDC</b><span>8 parts, 1 machine</span><em>22 km</em></div>
      </div></div>`, { tab: 'search', note: 'For urgent replacements (F5)' }),
  ]));

flows.push(flow('listing', 'Listing, matching side and seller', 'Scope U2, F3, F4',
  'The listing page answers the buyer’s questions in the order they ask them: is it the right part, does it fit my machine, which side, what condition, how many, how much, how far, and can I trust the seller.',
  () => [
    phone('Part listing', `<div class="gallery">${thumb('bracketL', 'hero')}<span class="gal-n">1 / 6</span><span class="gal-v">${ic('video')}Video</span>
        <div class="gal-top"><span class="iconbtn light">${ic('back')}</span><span><span class="iconbtn light">${ic('share')}</span><span class="iconbtn light">${ic('heart')}</span></span></div></div>
      <div class="pad detail">
        <div class="l-tags">${side('left', { size: 'lg' })}<span class="cond">Unused</span><span class="qty">14 pcs in stock</span></div>
        <h1 class="h1">Mudguard bracket, rear</h1>
        <p class="price xl">₹420 <small>per piece, negotiable</small></p>
        <div class="fits"><b>Fits</b><span>Mahindra 575 DI (2012–2020)</span><span>Mahindra 475 DI</span><span class="link sm">Check my machine</span></div>
        <div class="other-side">${side('right', { label: false })}<div><b>Right side also available</b><small>8 pcs from Om Agro Spares, Gondal</small></div>${ic('chevron')}</div>
        <h2 class="sec">Specifications</h2>
        ${specs([['Part number', '006012345C1'], ['Material', 'Pressed steel, 4 mm'], ['Finish', 'Primer, black'], ['Brand', 'Mahindra (OEM)'], ['Weight', '2.1 kg']])}
        <div class="seller">${thumb('gear', 'sm')}<div><b>Shree Ambica Engineering</b><span>Aji GIDC, Rajkot</span>${verified}</div><div class="sr"><b>4.7</b><small>23 deals</small></div></div>
      </div>${footer(`${btn('Enquire', 'ghost', 'chat')}${btn('Make offer')}`)}`, { note: 'Sticky actions; side and fit sit above the price' }),
    phone('Complementary side', `${appbar('Right side for this part', { sub: 'Mudguard bracket, Mahindra 575 DI' })}
      <div class="pad">
        <div class="pairing">${thumb('bracketL', 'sm')}<span class="plus">+</span>${thumb('bracketR', 'sm need')}<p>You have the left side. These sellers have the right one.</p></div>
      </div>
      ${listing({ part: 'bracketR', title: 'Mudguard bracket, rear', compat: 'Mahindra 575 DI', sideKind: 'right', cond: 'Unused', qty: '8 pcs', price: '₹440 /pc', place: 'Gondal', dist: '18 km' })}
      ${listing({ part: 'bracketR', title: 'Rear fender bracket RH', compat: 'Mahindra 575, 585', sideKind: 'right', cond: 'Used', qty: '2 pcs', price: '₹260 /pc', place: 'Jamnagar', dist: '87 km' })}
      <div class="pad"><div class="callout soft">${ic('bell')}<p>No match close enough? <b>Post a requirement</b> and we alert you when one is listed.</p></div></div>`, { note: 'Scope F3: show complementary parts' }),
    phone('Machine listing', `<div class="gallery">${thumb('lathe', 'hero')}<span class="gal-n">1 / 9</span><span class="gal-v">${ic('video')}Running video</span>
        <div class="gal-top"><span class="iconbtn light">${ic('back')}</span><span><span class="iconbtn light">${ic('heart')}</span></span></div></div>
      <div class="pad detail">
        <div class="l-tags"><span class="cond">Used</span><span class="qty">Year 2016</span><span class="qty">Under power</span></div>
        <h1 class="h1">CNC turning centre, Jyoti DX 200</h1>
        <p class="price xl">₹9,80,000 <small>negotiable</small></p>
        ${specs([['Controller', 'Fanuc 0i-TF'], ['Max turning dia.', '320 mm'], ['Chuck', '8 inch hydraulic'], ['Spindle hours', '11,400'], ['Inspection', 'Visit by appointment']])}
        <div class="seller">${thumb('lathe', 'sm')}<div><b>Precision Turners</b><span>Bhosari MIDC, Pune</span>${verified}</div><div class="sr"><b>4.9</b><small>8 deals</small></div></div>
      </div>${footer(`${btn('Ask for video', 'ghost', 'video')}${btn('Make offer')}`)}`),
    phone('Seller profile', `${appbar('Seller')}
      <div class="pad">
        <div class="sp-head">${thumb('gear')}<div><h1 class="h1">Shree Ambica Engineering</h1><p>Aji GIDC, Rajkot</p>${verified}</div></div>
        <div class="kpis"><div><b>4.7</b><span>Rating</span></div><div><b>23</b><span>Deals done</span></div><div><b>1 h</b><span>Usual reply</span></div></div>
        <div class="segmented"><span class="on">Listings 42</span><span>Reviews 19</span><span>About</span></div>
      </div>
      <div class="lgrid">${listing({ part: 'bracketL', title: 'Mudguard bracket, rear', sideKind: 'left', cond: 'Unused', qty: '14 pcs', price: '₹420 /pc', place: 'Aji GIDC' })}
      ${listing({ part: 'gear', title: 'Crown wheel and pinion 7:37', compat: 'Mahindra 575 DI', cond: 'New', qty: '3 sets', price: '₹12,800 /set', place: 'Aji GIDC' })}</div>`),
  ]));

flows.push(flow('sell', 'Sell a part, a machine, or rent one out', 'Scope U1, F2, F3',
  'One wizard for three kinds of listing. Fields after the category come from the admin’s template for that category, so a new part type needs no app release. Left / Right / Pair is its own step for parts that have sides.',
  () => [
    phone('What are you listing?', `${appbar('Sell', { back: false })}<div class="pad form">
        <h1 class="h1">What are you listing?</h1>
        ${[['gear', 'A spare part', 'New, used, unused or excess stock'], ['lathe', 'A machine for sale', 'Complete machines, running or not'], ['excavator', 'A machine for rent', 'By the hour, day, week or month'], ['doc', 'A requirement', 'Tell sellers what you need to buy']].map(([p, t, s], i) => `<div class="choice ${i === 0 ? 'on' : ''}">${thumb(p, 'sm')}<div><b>${t}</b><span>${s}</span></div><span class="radio"></span></div>`).join('')}
      </div>${footer(btn('Next'))}`, { tab: 'sell' }),
    phone('Category', `${appbar('Choose category')}${steps(1, 8, 'Category')}
      <div class="searchbar flat">${ic('search')}<span>Search: tie rod, bearing, servo…</span></div>
      <div class="crumbs"><span>Tractors</span>${ic('chevron')}<span>Mahindra</span>${ic('chevron')}<b>Body parts</b></div>
      <div class="tree">${['Mudguards & brackets', 'Bonnet & grille', 'Seat & platform', 'Hitch & drawbar', 'Lights & mirrors'].map((n, i) => `<div class="tree-row ${i === 0 ? 'on' : ''}"><span>${n}</span>${i === 0 ? ic('check') : ic('chevron')}</div>`).join('')}</div>`),
    phone('Part and specifications', `${appbar('Part details')}${steps(2, 8, 'Specifications')}<div class="pad form">
        ${field('Part name', 'Mudguard bracket, rear')}
        ${field('Part number', '006012345C1', { hint: 'Optional. Helps buyers with the exact match.' })}
        ${field('Material', 'Pressed steel')}
        ${field('Thickness', '4', { suffix: 'mm' })}
        ${field('Finish', 'Primer, black')}
        ${field('Weight', '2.1', { suffix: 'kg' })}
        <p class="fine">These fields are set by category. Mudguards ask for material and thickness; bearings ask for bore and OD.</p>
      </div>${footer(btn('Next'))}`),
    phone('Quantity and condition', `${appbar('Quantity and condition')}${steps(3, 8, 'Quantity')}<div class="pad form">
        <div class="two">${field('Quantity', '14')}${field('Unit', 'pcs', { suffix: '▾' })}</div>
        <div class="field"><span class="f-l">Condition</span>
        <div class="conds">${[['New', 'Never used, original packing'], ['Unused', 'Never fitted, packing may be open'], ['Used', 'Removed from a machine'], ['Excess', 'Surplus stock from a project']].map(([c, d], i) => `<div class="cnd ${i === 1 ? 'on' : ''}"><b>${c}</b><span>${d}</span></div>`).join('')}</div></div>
        ${field('Condition notes', 'Slight surface rust on 2 pieces', { hint: 'Optional' })}
      </div>${footer(btn('Next'))}`),
    phone('Brand, model and fit', `${appbar('Brand and fit')}${steps(4, 8, 'Compatibility')}<div class="pad form">
        ${field('Part brand', 'Mahindra (OEM)')}
        <div class="field"><span class="f-l">Fits these machines</span>
          <div class="fitlist"><span>Mahindra 575 DI <em>2012–2020</em>${ic('close')}</span><span>Mahindra 475 DI <em>all years</em>${ic('close')}</span></div>
          <span class="link sm">+ Add machine</span>
          <span class="f-h">Brand and model lists come from our catalogue, so buyers searching “575 DI” find you.</span></div>
      </div>${footer(btn('Next'))}`),
    phone('Which side?', `${appbar('Which side?')}${steps(5, 8, 'Side')}<div class="pad form">
        <h1 class="h1">Is this a left, right or pair?</h1>
        <p class="lead">Seen standing behind the machine, facing forward.</p>
        <div class="sidebig">
          ${[['left', 'Left only'], ['right', 'Right only'], ['pair', 'Pair (both sides)'], ['none', 'No side']].map(([k, t], i) => `<div class="sb ${i === 0 ? 'on' : ''}">${k === 'none' ? `<span class="side xl"><span class="sd none"><i>–</i></span></span>` : side(k, { label: false, size: 'xl' })}<b>${t}</b></div>`).join('')}
        </div>
        <div class="callout soft">${ic('info')}<p>Buyers who have the right side will see your left one as a match.</p></div>
      </div>${footer(btn('Next'))}`, { note: 'The step this marketplace is built around (F3)' }),
    phone('Photos and video', `${appbar('Photos and video')}${steps(6, 8, 'Media')}<div class="pad form">
        <div class="photos">
          <div class="ph main">${thumb('bracketL')}<span>Cover</span></div><div class="ph">${thumb('bracketL')}</div><div class="ph">${thumb('bracketL')}</div>
          <div class="ph add">${ic('camera')}<span>Add photo</span></div><div class="ph add">${ic('video')}<span>Add video</span></div>
        </div>
        <div class="tips"><b>Photos that sell</b><span>${ic('check')}The part number or nameplate</span><span>${ic('check')}Both faces, and any wear or rust</span><span>${ic('check')}A video of a machine running</span></div>
      </div>${footer(btn('Next'))}`),
    phone('Price', `${appbar('Price')}${steps(7, 8, 'Price')}<div class="pad form">
        <div class="field"><span class="f-l">How do you want to price it?</span>
        <div class="segmented big"><span>Fixed</span><span class="on">Negotiable</span><span>On request</span></div></div>
        <div class="two">${field('Price', '₹420')}${field('Per', 'piece')}</div>
        ${field('Minimum order', '2', { suffix: 'pcs', hint: 'Optional' })}
        <p class="fine">Negotiable: buyers can make offers. Price on request: buyers must enquire.</p>
      </div>${footer(btn('Next'))}`),
    phone('Location', `${appbar('Where is the stock?')}${steps(8, 8, 'Location')}<div class="pad form">
        <div class="choice on">${ic('pin')}<div><b>My business address</b><span>Plot 214, Aji GIDC, Rajkot</span></div><span class="radio"></span></div>
        <div class="choice">${ic('box')}<div><b>Another godown</b><span>Add an address or pin on map</span></div><span class="radio"></span></div>
        <div class="field"><span class="f-l">Delivery</span>${chips(['Buyer picks up', 'I can ship', 'Local delivery'], ['Buyer picks up', 'I can ship'])}</div>
      </div>${footer(btn('Preview listing'))}`),
    phone('Preview', `${appbar('Preview', { right: '<span class="link sm">Edit</span>' })}
      <div class="previewnote">${ic('info')}This is how buyers will see it.</div>
      <div class="gallery short">${thumb('bracketL', 'hero')}</div>
      <div class="pad detail">
        <div class="l-tags">${side('left', { size: 'lg' })}<span class="cond">Unused</span><span class="qty">14 pcs</span></div>
        <h1 class="h1">Mudguard bracket, rear</h1><p class="price xl">₹420 <small>per piece, negotiable</small></p>
        <div class="fits"><b>Fits</b><span>Mahindra 575 DI (2012–2020)</span><span>Mahindra 475 DI</span></div>
        <div class="checklist"><span>${ic('check')}6 photos</span><span>${ic('check')}Part number added</span><span class="warn">${ic('info')}No video yet</span></div>
      </div>${footer(btn('Publish listing'))}`),
    phone('Published', `<div class="done">
        <div class="done-mark">${ic('check')}</div>
        <h1 class="h1">Listing sent for review</h1>
        <p class="lead">Your first listing is checked by our team, usually within 2 hours. After that, listings from verified sellers go live straight away.</p>
        <div class="matchnote">${side('want-left', { label: false, size: 'lg' })}<p><b>3 buyers are looking for this part.</b> We will tell them when it goes live.</p></div>
        ${btn('View my listing', 'ghost')}${btn('List another part')}
      </div>`, { note: 'Matching part requests are alerted on publish (F8)' }),
  ]));

flows.push(flow('negotiate', 'Enquiry, chat and offers', 'Scope U1, U2, F6',
  'Every conversation is about one listing. Quick enquiries cover the questions sellers get all day; offers are structured cards in the chat, so price, quantity and status are never lost in text.',
  () => [
    phone('Enquire', `<div class="dim">${thumb('cylinder', 'hero')}</div>`, {
      overlay: sheet('Ask the seller', `<p class="lead">Hydraulic boom cylinder, JCB 3DX</p>
        <div class="quick">${['Is it still available?', 'Send more photos', 'Send a video', 'Full specifications', 'Will it fit my machine?', 'Best price for 2 pcs'].map((q, i) => `<span class="${i === 0 || i === 4 ? 'on' : ''}">${q}</span>`).join('')}</div>
        ${field('Add a message', 'My machine is a 2018 JCB 3DX Super. Bore 90 mm?', { hint: 'Optional' })}
        ${btn('Send enquiry')}`),
      note: 'Quick enquiry options (F6)',
    }),
    phone('Chat thread', `${appbar('Om Agro Spares', { sub: 'Hydraulic boom cylinder, ₹38,500', right: `<span class="iconbtn">${ic('phone')}</span>` })}
      <div class="chat">
        <div class="msg me">Is it still available? Will it fit my machine? <small>10:12</small></div>
        <div class="msg">Yes, 2 pcs. Fits 3DX and 3DX Super, bore 90 mm. <small>10:20</small></div>
        <div class="msg media">${thumb('cylinder', 'sm')}${thumb('cylinder', 'sm')}<small>2 photos, 10:21</small></div>
        <div class="offer">
          <div class="o-h"><b>Your offer</b><span class="st wait">Waiting for seller</span></div>
          <div class="o-r"><span>Price</span><b>₹34,000 /pc</b></div><div class="o-r"><span>Quantity</span><b>2 pcs</b></div><div class="o-r"><span>Total</span><b>₹68,000</b></div>
          <small>Valid for 48 hours</small>
        </div>
      </div>
      <div class="composer"><span class="iconbtn">${ic('plus')}</span><span class="cin">Message</span><span class="iconbtn">${ic('mic')}</span><span class="iconbtn send">${ic('send')}</span></div>`, { note: 'Number shared only after a deal, or when either side chooses' }),
    phone('Make an offer', `<div class="dim">${thumb('cylinder', 'hero')}</div>`, {
      overlay: sheet('Make an offer', `<div class="offerform">
        <div class="asked"><span>Seller asks</span><b>₹38,500 /pc</b></div>
        <div class="two">${field('Your price', '₹34,000')}${field('Quantity', '2 pcs')}</div>
        <div class="field"><span class="f-l">Offer valid for</span>${chips(['24 hours', '48 hours', '7 days'], ['48 hours'])}</div>
        ${field('Note', 'Can collect from Shapar on Saturday', { hint: 'Optional' })}
        <div class="total"><span>Total</span><b>₹68,000</b></div>
        ${btn('Send offer')}</div>`),
    }),
    phone('Offer received (seller)', `${appbar('Kamal Earthmovers', { sub: 'Hydraulic boom cylinder' })}
      <div class="chat">
        <div class="offer big">
          <div class="o-h"><b>New offer</b><span class="st new">Respond in 47 h</span></div>
          <div class="o-r"><span>Price</span><b>₹34,000 /pc</b><em>12% below your price</em></div><div class="o-r"><span>Quantity</span><b>2 of 2 pcs</b></div><div class="o-r"><span>Total</span><b>₹68,000</b></div>
          <p>“Can collect from Shapar on Saturday”</p>
          <div class="o-act">${btn('Reject', 'ghost')}${btn('Counter', 'ghost')}${btn('Accept')}</div>
        </div>
      </div>`, { note: 'Seller can accept, reject or counter' }),
    phone('Counteroffer', `${appbar('Kamal Earthmovers', { sub: 'Hydraulic boom cylinder' })}
      <div class="chat">
        <div class="offer"><div class="o-h"><b>Their offer</b><span class="st">Countered</span></div><div class="o-r"><span>Price</span><b>₹34,000 /pc</b></div></div>
        <div class="offer mine"><div class="o-h"><b>Your counter</b><span class="st wait">Round 1 of 5</span></div><div class="o-r"><span>Price</span><b>₹36,500 /pc</b></div><div class="o-r"><span>Quantity</span><b>2 pcs</b></div><div class="o-r"><span>Total</span><b>₹73,000</b></div></div>
        <div class="sys">Kamal Earthmovers accepted ₹36,500 /pc. Deal recorded.</div>
        <div class="dealcard">${ic('deal')}<div><b>Deal agreed</b><span>2 pcs at ₹36,500, total ₹73,000</span></div>${ic('chevron')}</div>
      </div>`),
    phone('Enquiries inbox', `${appbar('Enquiries', { back: false })}
      <div class="segmented pad-x"><span class="on">All</span><span>Buying</span><span>Selling</span><span>Your turn 3</span></div>
      <div class="inbox">
        ${[['cylinder', 'Kamal Earthmovers', 'Countered ₹36,500', 'turn', '2m'], ['bracketR', 'Om Agro Spares', 'Sent 2 photos', '', '1h'], ['lathe', 'Precision Turners', 'You: Can I visit on Monday?', '', 'Tue'], ['bearing', 'Bharat Bearings', 'Offer accepted', 'deal', 'Mon']].map(([p, n, m, s, t]) => `<div class="row">${thumb(p, 'sm')}<div><b>${n}</b><span>${m}</span></div><div class="rt"><small>${t}</small>${s === 'turn' ? '<i class="pill">Your turn</i>' : s === 'deal' ? '<i class="pill ok">Deal</i>' : ''}</div></div>`).join('')}
      </div>`, { tab: 'chats' }),
  ]));

flows.push(flow('deals', 'Deals and reviews', 'Scope U1, U2, F7',
  'An accepted offer becomes a deal record for both sides, with the agreed price and quantity, even when payment happens outside the app. The seller marks it sold (or rented); both sides review after completion.',
  () => [
    phone('Deal record', `${appbar('Deal', { sub: 'With Kamal Earthmovers' })}<div class="pad">
        <div class="dealhead">${thumb('cylinder', 'sm')}<div><b>Hydraulic boom cylinder</b><span>JCB 3DX</span></div><span class="st ok">Agreed</span></div>
        ${specs([['Agreed price', '₹36,500 /pc'], ['Quantity', '2 pcs'], ['Total', '₹73,000'], ['Payment', 'Outside the app'], ['Pickup', 'Shapar, Saturday']])}
        <div class="timeline">${[['Enquiry', 'Mon 10:12', true], ['Offer and counter', 'Mon 11:40', true], ['Deal agreed', 'Mon 12:05', true], ['Handed over', 'Waiting', false], ['Reviews', '', false]].map(([t, d, ok]) => `<div class="${ok ? 'ok' : ''}"><i></i><b>${t}</b><small>${d}</small></div>`).join('')}</div>
      </div>${footer(`${btn('Cancel deal', 'ghost')}${btn('Mark handed over')}`)}`),
    phone('My deals', `${appbar('Deals', { back: false })}
      <div class="segmented pad-x"><span class="on">Active 2</span><span>Completed 23</span><span>Cancelled</span></div>
      <div class="inbox">
        ${[['cylinder', 'Hydraulic boom cylinder', 'Buying, ₹73,000', 'Agreed'], ['excavator', 'JCB 3DX, 3 days rental', 'Renting out, ₹28,800', 'Booked'], ['bearing', 'Spindle bearing NSK 7014', 'Selling, ₹18,400', 'Completed']].map(([p, n, m, s]) => `<div class="row">${thumb(p, 'sm')}<div><b>${n}</b><span>${m}</span></div><div class="rt"><i class="pill ${s === 'Completed' ? 'ok' : ''}">${s}</i></div></div>`).join('')}
      </div>`, { tab: 'deals' }),
    phone('Review', `${appbar('Review the seller')}<div class="pad form">
        <div class="dealhead">${thumb('cylinder', 'sm')}<div><b>Kamal Earthmovers</b><span>Hydraulic boom cylinder, ₹73,000</span></div></div>
        ${[['Part matched the listing', 5], ['Communication', 4], ['Handover on time', 5]].map(([t, n]) => `<div class="rate"><span>${t}</span><span class="stars">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}">${ic('star')}</i>`).join('')}</span></div>`).join('')}
        ${field('Anything else?', 'Exactly as described, bore 90 mm.', { hint: 'Optional, shown publicly' })}
        <p class="fine">Reviews are published when both sides have reviewed, or after 7 days.</p>
      </div>${footer(btn('Submit review'))}`),
  ]));

flows.push(flow('requirements', 'Buyer requirements and availability alerts', 'Scope U3, F8 (and RFQ, as in the textile project’s M9)',
  'When a buyer cannot find a part, a machine or a rental, they post a requirement. It stays active until fulfilled or closed. Matching sellers are told (a few at a time, never a broadcast) and can reply with one of their listings or a quote; every new listing is checked against open requirements, and the buyer is alerted on a match.',
  () => [
    phone('Post a requirement', `${appbar('Post a requirement')}<div class="pad form">
        <div class="field"><span class="f-l">What do you need?</span><div class="segmented big"><span class="on">A part</span><span>A machine</span><span>A rental</span></div></div>
        ${field('Category', 'Trucks, Tata, Steering & linkages')}
        ${field('Part name', 'Tie rod end, outer')}
        ${field('Part number', '257133100101', { hint: 'Optional' })}
        <div class="field"><span class="f-l">Side</span><div class="sidepick">${['left', 'right', 'pair'].map((k) => `<span class="sp ${k === 'right' ? 'on' : ''}">${side(k)}</span>`).join('')}</div></div>
        <div class="two">${field('Quantity', '4')}${field('Unit', 'pcs')}</div>
        ${field('Fits', 'Tata LPT 1613, 2016')}
      </div>${footer(btn('Next'))}`, { tab: 'sell' }),
    phone('Requirement details', `${appbar('A few more details')}<div class="pad form">
        <div class="field"><span class="f-l">Condition you accept</span>${chips(['New', 'Unused', 'Used', 'Excess'], ['New', 'Unused', 'Used'])}</div>
        <div class="two">${field('Budget per unit', '₹1,200', { hint: 'Optional' })}${field('Needed by', '25 Nov')}</div>
        ${field('Deliver to', 'Aji GIDC, Rajkot')}
        <div class="field"><span class="f-l">Search radius</span>${chips(['50 km', '200 km', 'Gujarat', 'All India'], ['200 km'])}</div>
        <div class="field"><span class="f-l">Who can reply?</span>${chips(['Verified sellers only', 'Any seller'], ['Verified sellers only'])}</div>
        <p class="fine">We send it to up to 15 matching sellers. Your number stays hidden.</p>
      </div>${footer(btn('Post requirement'))}`),
    phone('My requirements', `${appbar('My requirements', { right: '<span class="link sm">+ New</span>' })}
      <div class="segmented pad-x"><span class="on">Active 3</span><span>Fulfilled 5</span><span>Closed</span></div>
      <div class="reqs">
        <div class="req">${side('want-right', { label: false })}<div><b>Tie rod end, outer</b><span>4 pcs, Tata LPT 1613</span><em class="m">3 replies, 2 matches</em></div>${ic('chevron')}</div>
        <div class="req">${thumb('lathe', 'xs')}<div><b>Used CNC lathe, 250 mm chuck</b><span>Under ₹12 lakh, Gujarat</span><em>1 reply</em></div>${ic('chevron')}</div>
        <div class="req">${thumb('forklift', 'xs')}<div><b>Forklift 3 T for 2 weeks</b><span>From 1 Dec, Shapar</span><em>Waiting for replies</em></div>${ic('chevron')}</div>
      </div>`),
    phone('Replies and matches', `${appbar('Tie rod end, outer', { sub: 'Right side, 4 pcs, Tata LPT 1613' })}
      <div class="segmented pad-x"><span class="on">Replies 3</span><span>Auto matches 2</span></div>
      <div class="replies">
        <div class="reply"><div class="rp-h"><b>Bharat Auto Spares</b>${verified}</div>${listing({ part: 'bracketR', title: 'Tie rod end, outer RH', sideKind: 'right', cond: 'New', qty: '10 pcs', price: '₹1,150 /pc', place: 'Rajkot', dist: '6 km' })}<p>“OEM, can deliver tomorrow.”</p></div>
        <div class="reply"><div class="rp-h"><b>Morbi Truck Parts</b></div><div class="quote"><span>Quote</span><b>₹980 /pc, 4 pcs</b><small>Aftermarket, ships in 3 days</small></div></div>
      </div>
      <div class="pad">${btn('Compare 3 replies', 'ghost')}</div>`, { note: 'Sellers reply with a listing or a quote' }),
    phone('Match alert', `<div class="lock">
        <b class="lock-t">9:41</b><span class="lock-d">Monday 18 November</span>
        <div class="notif"><div class="n-h">${ic('bell')}<b>Machine Parts</b><small>now</small></div><b>Your right tie rod end is available</b><p>Tata LPT 1613, new, 6 km away in Bhaktinagar. Open the listing to make an offer.</p></div>
        <div class="notif dim2"><div class="n-h">${ic('chat')}<b>Machine Parts</b><small>12 min</small></div><b>Om Agro Spares replied</b><p>Sent 2 photos of the mudguard bracket.</p></div>
      </div>`, { cls: 'dark', note: 'Push notification (F9)' }),
    phone('Seller sees a requirement', `${appbar('Buyers looking for your parts', { back: false })}
      <div class="pad"><p class="lead">Matched to your categories and stock.</p></div>
      <div class="reqcards">
        <div class="rq">${side('want-left', { label: false })}<div><b>Mudguard bracket, rear</b><span>Left side, 6 pcs, Mahindra 575 DI</span><span>Wankaner, 38 km, needed by 22 Nov</span><div class="rq-a">${btn('Reply with my listing')}${btn('Send a quote', 'ghost')}</div></div></div>
        <div class="rq">${thumb('bearing', 'xs')}<div><b>Spindle bearing 7014</b><span>2 pcs, angular contact</span><span>Ahmedabad, 210 km</span><div class="rq-a">${btn('Send a quote', 'ghost')}</div></div></div>
      </div>`, { tab: 'chats' }),
  ]));

flows.push(flow('rental', 'Machinery rental', 'Scope F5, F7, F9',
  'Rental listings show the rate per period and where the machine works. A booking request names dates and whether an operator is needed; the owner confirms, and both sides get booking updates until the machine is returned.',
  () => [
    phone('Rental listing', `<div class="gallery">${thumb('excavator', 'hero')}<span class="gal-n">1 / 7</span>
        <div class="gal-top"><span class="iconbtn light">${ic('back')}</span><span class="iconbtn light">${ic('heart')}</span></div></div>
      <div class="pad detail">
        <div class="l-tags"><span class="cond">For rent</span><span class="qty">With operator</span><span class="qty">2019</span></div>
        <h1 class="h1">JCB 3DX Super backhoe loader</h1>
        <div class="rates"><div><b>₹1,400</b><span>per hour</span></div><div><b>₹9,600</b><span>per day</span></div><div><b>₹58,000</b><span>per week</span></div></div>
        ${specs([['Works within', '60 km of Shapar'], ['Minimum', '4 hours'], ['Diesel', 'By hirer'], ['Transport', '₹2,500 each way']])}
        <div class="avail"><b>Availability</b><div class="days">${['M', 'T', 'W', 'T', 'F', 'S', 'S', 'M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => `<span class="${[2, 3, 9].includes(i) ? 'busy' : ''}">${d}</span>`).join('')}</div></div>
      </div>${footer(btn('Request booking'))}`),
    phone('Booking request', `${appbar('Request booking')}<div class="pad form">
        <div class="two">${field('From', 'Thu 21 Nov')}${field('To', 'Sat 23 Nov')}</div>
        <div class="field"><span class="f-l">Charged by</span><div class="segmented big"><span>Hour</span><span class="on">Day</span><span>Week</span></div></div>
        ${field('Site', 'Survey 112, Kotda Sangani', { hint: '38 km from the machine' })}
        <div class="field"><span class="f-l">Operator</span>${chips(['With operator', 'Without operator'], ['With operator'])}</div>
        <div class="total"><span>3 days</span><b>₹28,800 + transport</b></div>
      </div>${footer(btn('Send request'))}`),
    phone('Booking updates', `${appbar('Booking', { sub: 'JCB 3DX Super, Kamal Earthmovers' })}<div class="pad">
        <div class="dealhead">${thumb('excavator', 'sm')}<div><b>21 to 23 Nov</b><span>3 days, with operator</span></div><span class="st ok">Confirmed</span></div>
        <div class="timeline">${[['Requested', 'Mon 14:02', true], ['Confirmed by owner', 'Mon 15:30', true], ['Machine on site', 'Thu, expected 8:00', false], ['Returned', '', false], ['Reviews', '', false]].map(([t, d, ok]) => `<div class="${ok ? 'ok' : ''}"><i></i><b>${t}</b><small>${d}</small></div>`).join('')}</div>
      </div>${footer(`${btn('Message owner', 'ghost', 'chat')}${btn('Mark on site')}`)}`),
  ]));

flows.push(flow('seller', 'Seller dashboard and listings', 'Scope U1, F1, F2',
  'Sellers see what needs them first (enquiries waiting, offers to answer, requirements they can serve), then their listings by status, where they edit, pause, mark sold or remove.',
  () => [
    phone('Seller dashboard', `${appbar('My business', { back: false, right: `<span class="iconbtn">${ic('bell')}</span>` })}<div class="pad">
        <div class="needs"><b>Needs you</b>
          <div class="nrow"><span class="nn">3</span><span>Offers to answer</span>${ic('chevron')}</div>
          <div class="nrow"><span class="nn">5</span><span>Enquiries without a reply</span>${ic('chevron')}</div>
          <div class="nrow"><span class="nn">2</span><span>Buyers looking for your parts</span>${ic('chevron')}</div>
        </div>
        <div class="kpis"><div><b>42</b><span>Live listings</span></div><div><b>318</b><span>Views this week</span></div><div><b>₹4.2 L</b><span>Deals this month</span></div></div>
        <div class="callout soft">${ic('camera')}<p><b>7 listings have no video.</b> Listings with video get twice the enquiries.</p></div>
      </div>`, { tab: 'deals' }),
    phone('My listings', `${appbar('My listings', { right: '<span class="link sm">+ Sell</span>' })}
      <div class="segmented pad-x"><span class="on">Live 42</span><span>In review 1</span><span>Paused 3</span><span>Sold 61</span></div>
      ${listing({ part: 'bracketL', title: 'Mudguard bracket, rear', sideKind: 'left', cond: 'Unused', qty: '14 pcs', price: '₹420 /pc', place: '96 views, 4 enquiries' })}
      ${listing({ part: 'gear', title: 'Crown wheel and pinion 7:37', cond: 'New', qty: '3 sets', price: '₹12,800 /set', place: '41 views, 1 offer' })}
      ${listing({ part: 'bearing', title: 'Spindle bearing NSK 7014', cond: 'New', qty: '0 left', price: '₹9,200 /pc', place: 'Sold out', tag: 'Mark sold?' })}`),
    phone('Manage a listing', `<div class="dim">${listing({ part: 'bracketL', title: 'Mudguard bracket, rear', sideKind: 'left', cond: 'Unused', qty: '14 pcs', price: '₹420 /pc', place: 'Aji GIDC' })}</div>`, {
      overlay: sheet('Mudguard bracket, rear', `<div class="actions">
        <div>${ic('edit')}<span>Edit listing</span></div>
        <div>${ic('box')}<span>Update quantity</span></div>
        <div>${ic('pause')}<span>Pause, hide from buyers</span></div>
        <div>${ic('check')}<span>Mark sold</span></div>
        <div>${ic('flag')}<span>Mark unavailable</span></div>
        <div class="danger">${ic('trash')}<span>Remove listing</span></div></div>`),
    }),
  ]));

flows.push(flow('account', 'Notifications, saved and profile', 'Scope F1, F4, F9',
  'Notifications are grouped by what the person has to do. Saved listings warn when price or stock changes. The profile holds the business, verification, language and appearance.',
  () => [
    phone('Notifications', `${appbar('Notifications', { back: false })}
      <div class="notes">
        ${[['bell', 'New matching part', 'Right tie rod end, Tata 1613, 6 km away', 'now', true], ['rupee', 'New offer', 'Kamal Earthmovers offered ₹34,000 /pc', '12 min', true], ['chat', 'New message', 'Om Agro Spares sent 2 photos', '1 h', false], ['calendar', 'Booking confirmed', 'JCB 3DX Super, 21 to 23 Nov', '3 h', false], ['shield', 'Listing approved', 'Mudguard bracket is now live', 'Mon', false], ['deal', 'Deal completed', 'Leave a review for Bharat Bearings', 'Sun', false]].map(([i, t, d, w, n]) => `<div class="note ${n ? 'new' : ''}"><span class="ni">${ic(i)}</span><div><b>${t}</b><span>${d}</span></div><small>${w}</small></div>`).join('')}
      </div>`),
    phone('Saved', `${appbar('Saved')}
      ${listing({ part: 'motor', title: 'Servo motor, Fanuc αiS 12', compat: 'Fanuc 0i controllers', cond: 'Used', qty: '1 pc', price: '₹46,000', place: 'Vatva GIDC', dist: '210 km', tag: 'Price dropped ₹4,000' })}
      ${listing({ part: 'press', title: 'Power press 50 T, C-frame', cond: 'Used', qty: '1 machine', price: '₹3,40,000', place: 'Ludhiana', tag: 'Only 1 left' })}
      ${listing({ part: 'chain', title: 'Stenter chain, 40 m', cond: 'Excess', qty: '40 m', price: '₹950 /m', place: 'Surat', dist: '' })}`),
    phone('Profile', `${appbar('Profile', { back: false })}<div class="pad">
        <div class="sp-head">${thumb('gear')}<div><h1 class="h1">Hitesh Patel</h1><p>Shree Ambica Engineering</p>${verified}</div></div>
        <div class="menu">
          ${[['user', 'Business profile', ''], ['pin', 'Location and industrial area', 'Aji GIDC'], ['shield', 'GST verification', 'Verified'], ['doc', 'My requirements', '3 active'], ['heart', 'Saved listings', '12'], ['star', 'Reviews', '4.7'], ['globe', 'Language', 'ગુજરાતી'], ['sun', 'Appearance', 'System'], ['logout', 'Log out', '']].map(([i, t, v]) => `<div>${ic(i)}<span>${t}</span><em>${v}</em>${ic('chevron')}</div>`).join('')}
        </div></div>`),
    phone('In Gujarati', `<div class="homehead"><div class="home-top">
        <div class="loc">${ic('pin')}<span><b>આજી GIDC, રાજકોટ</b><small>25 કિમી અંદર</small></span>${ic('down')}</div>
        <span class="iconbtn">${ic('bell')}</span>
      </div>
      <div class="searchbar">${ic('search')}<span>પાર્ટ, મશીન, બ્રાન્ડ કે પાર્ટ નંબર</span></div></div>
      <div class="sidematch">${side('want-right', { label: false, size: 'lg' })}<div><b>તમારા ડાબા ટાઇ રૉડ એન્ડ માટે 2 જમણા મળ્યા</b><small>તમારી માંગણીમાંથી, 6 કિમી દૂર</small></div>${ic('chevron')}</div>
      <h2 class="sec">તમારી નજીક</h2>
      <div class="lgrid">${listing({ part: 'cylinder', title: 'હાઇડ્રોલિક બૂમ સિલિન્ડર', compat: 'JCB 3DX', fits: 'ફિટ થાય:', cond: 'જૂનો', qty: '2 નંગ', price: '₹38,500', place: 'શાપર, રાજકોટ', dist: '9 કિમી' })}
      ${listing({ part: 'bracketL', title: 'મડગાર્ડ બ્રૅકેટ', compat: 'Mahindra 575 DI', fits: 'ફિટ થાય:', sideKind: 'left', cond: 'વપરાયો નથી', qty: '14 નંગ', price: '₹420 /નંગ', place: 'આજી GIDC', dist: '2 કિમી' })}</div>`, { tab: 'home', note: 'Every screen ships in English, Hindi and Gujarati', cls: 'lang-gu' }),
  ]));

// ─── admin panel ────────────────────────────────────────────────────────────
const adminNav = [
  ['Dashboard', 'grid'], ['Listing moderation', 'layers', 7], ['Business verification', 'shield', 4], ['Reports & flags', 'flag', 2],
  ['Users & businesses', 'user'], ['Parts & machinery', 'box'], ['Requirements', 'doc'], ['Enquiries & offers', 'chat'],
  ['Deals', 'deal'], ['Rental bookings', 'calendar'], ['Categories & machine types', 'layers'], ['Brands, models & fit', 'wrench'],
  ['Specifications & fields', 'edit'], ['Units, conditions & sides', 'filter'], ['Activity & KPIs', 'star'],
];
function adminFrame(active, title, body, caption) {
  screenNo += 1;
  return `<figure class="shot wide">
  <div class="desk"><aside class="a-side"><div class="a-logo">${side('pair', { label: false })}<b>Machine Parts</b><small>Admin</small></div>
    ${adminNav.map(([n, i, c]) => `<div class="a-nav ${n === active ? 'on' : ''}">${ic(i)}<span>${n}</span>${c ? `<em>${c}</em>` : ''}</div>`).join('')}</aside>
    <main class="a-main"><div class="a-top"><h3>${title}</h3><div class="a-search">${ic('search')}<span>Search listings, businesses, GSTIN</span></div><span class="a-me">Super admin</span></div>${body}</main></div>
  <figcaption><span class="num">${flowNo}.${screenNo}</span><span><b>${caption}</b></span></figcaption>
</figure>`;
}
flows.push(flow('admin', 'Admin panel', 'Scope U4, A1–A6',
  'Desktop-first, same tokens as the app. Queues come first (what is waiting on the team); machine configuration is where categories, brands, models, fit, units, conditions and side options are managed without an app release.',
  () => [
    adminFrame('Dashboard', 'Dashboard', `<div class="a-kpis">${[['Businesses', '2,418', '+64 this week'], ['Active listings', '11,906', '+812'], ['Parts available', '9,874', ''], ['Machines for rent', '214', '+9'], ['New enquiries', '1,322', 'this week'], ['Offers', '486', ''], ['Deals', '173', '₹1.9 Cr'], ['Rental bookings', '58', '']].map(([t, v, s]) => `<div><span>${t}</span><b>${v}</b><small>${s}</small></div>`).join('')}</div>
      <div class="a-grid"><div class="a-card"><h4>Enquiries to deals, last 8 weeks</h4><div class="bars">${[38, 44, 41, 52, 49, 61, 58, 66].map((h, i) => `<i style="height:${h}%"><em style="height:${Math.round(h * 0.28)}%"></em></i>`).join('')}</div><p class="legend"><span class="lg1"></span>Enquiries <span class="lg2"></span>Deals</p></div>
      <div class="a-card"><h4>Top industrial areas</h4>${[['Shapar-Veraval, Rajkot', 1240], ['Vatva GIDC, Ahmedabad', 1104], ['Bhosari MIDC, Pune', 906], ['Focal Point, Ludhiana', 711], ['SIDCO, Coimbatore', 598]].map(([n, v]) => `<div class="hbar"><span>${n}</span><i style="width:${v / 13}%"></i><b>${v}</b></div>`).join('')}</div></div>`, 'Dashboard KPIs (A1)'),
    adminFrame('Listing moderation', 'Listing moderation', `<div class="a-split"><div class="a-queue">${[['bracketL', 'Mudguard bracket, rear', 'Shree Ambica Engineering', 'First listing', true], ['lathe', 'CNC turning centre DX 200', 'Precision Turners', 'Price check', false], ['motor', 'Servo motor αiS 12', 'Vatva Automation', 'Reported once', false], ['chain', 'Stenter chain, 40 m', 'Surat Textile Spares', '', false]].map(([p, t, s, f, on]) => `<div class="q ${on ? 'on' : ''}">${thumb(p, 'xs')}<div><b>${t}</b><span>${s}</span></div>${f ? `<i class="pill">${f}</i>` : ''}</div>`).join('')}</div>
      <div class="a-review"><div class="a-rh">${thumb('bracketL', 'sm')}<div><h4>Mudguard bracket, rear</h4><p>Shree Ambica Engineering, Aji GIDC, Rajkot</p></div>${side('left', { size: 'lg' })}</div>
      <div class="a-photos">${[1, 2, 3, 4, 5, 6].map(() => thumb('bracketL', 'sm')).join('')}</div>
      ${specs([['Category', 'Tractors / Mahindra / Body parts / Mudguards'], ['Condition', 'Unused'], ['Quantity', '14 pcs'], ['Fits', 'Mahindra 575 DI (2012–2020), 475 DI'], ['Price', '₹420 per piece, negotiable'], ['Part number', '006012345C1']])}
      <div class="a-act">${btn('Reject with reason', 'ghost')}${btn('Ask for changes', 'ghost')}${btn('Approve')}</div></div></div>`, 'Listing moderation (A3)'),
    adminFrame('Categories & machine types', 'Categories & machine types', `<div class="a-split"><div class="a-tree">${[['Tractors', 0, false], ['Mahindra', 1, false], ['Body parts', 2, false], ['Mudguards & brackets', 3, true], ['Bonnet & grille', 3, false], ['Transmission', 2, false], ['Earthmoving', 0, false], ['Backhoe loaders', 1, false], ['CNC & machine tools', 0, false], ['Textile machinery', 0, false], ['Plastic moulding', 0, false]].map(([n, d, on]) => `<div class="tn ${on ? 'on' : ''}" style="padding-left:${12 + d * 18}px">${d < 3 ? ic('down') : ''}<span>${n}</span></div>`).join('')}</div>
      <div class="a-review"><h4>Mudguards & brackets</h4><p class="muted">Tractors / Mahindra / Body parts</p>
      <div class="a-fields"><div class="af-h"><span>Field</span><span>Type</span><span>Required</span></div>${[['Part number', 'Text', 'No'], ['Material', 'Choice', 'Yes'], ['Thickness', 'Number, mm', 'No'], ['Finish', 'Choice', 'No'], ['Weight', 'Number, kg', 'No']].map(([a, b, c]) => `<div><span>${a}</span><span>${b}</span><span>${c}</span></div>`).join('')}</div>
      <div class="a-toggle"><span class="sw on"></span><div><b>Parts in this category have sides</b><small>Sellers must choose Left, Right, Pair or No side; buyers can filter by side and see complementary parts.</small></div></div>
      <div class="a-act">${btn('Preview seller form', 'ghost')}${btn('Save changes')}</div></div></div>`, 'Machine configuration and side options (A4)'),
    adminFrame('Business verification', 'Business verification', `<div class="a-split"><div class="a-queue">${[['Shree Ambica Engineering', 'Rajkot, 2 h ago', true], ['Kamal Earthmovers', 'Shapar, 5 h ago', false], ['Vatva Automation', 'Ahmedabad, 1 d ago', false], ['Bharat Auto Spares', 'Rajkot, 1 d ago', false]].map(([t, s, on]) => `<div class="q ${on ? 'on' : ''}"><div><b>${t}</b><span>${s}</span></div></div>`).join('')}</div>
      <div class="a-review"><h4>Shree Ambica Engineering</h4>
      <div class="a-compare"><div><span class="muted">From the business</span>${specs([['Trade name', 'Shree Ambica Engineering'], ['GSTIN', '24AAKFS4821M1Z6'], ['Address', 'Plot 214, Aji GIDC, Rajkot'], ['Phone', '+91 98250 41736']])}</div>
      <div><span class="muted">From the GST network</span>${specs([['Legal name', 'Shree Ambica Engineering'], ['Status', 'Active since 2011'], ['Type', 'Partnership'], ['Principal place', 'Plot 214, Aji GIDC, Rajkot 360003']])}</div></div>
      <div class="a-act">${btn('Reject with reason', 'ghost')}${btn('Approve verification')}</div></div></div>`, 'GST and business verification (A2)'),
  ]));

// ─── page ───────────────────────────────────────────────────────────────────
const nav = [['onboarding', 'Sign in'], ['discover', 'Browse'], ['listing', 'Listing'], ['sell', 'Sell'], ['negotiate', 'Offers'], ['deals', 'Deals'], ['requirements', 'Requirements'], ['rental', 'Rental'], ['seller', 'Seller'], ['account', 'Account'], ['admin', 'Admin']];

// Direction B, "workshop enamel": warm paper, the green enamel of Indian machine tools, signal orange for the one main
// action, parts shown like product photos, numbers and part numbers in a catalogue mono, and the L | R side token.
const css = String.raw`
:root{
  --paper:#F3EFE7; --surface:#FFFFFF; --ink:#1C1E1B; --ink-2:#4A4E47; --ink-3:#7A7F77; --line:#E1DBCF; --line-2:#EEE9DF;
  --enamel:#1F5641; --enamel-bg:#1F5641; --on-enamel:#F6F2EA; --enamel-soft:#E0EBE4;
  --signal:#DD5119; --signal-ink:#FFFFFF; --signal-soft:#FCE7DC;
  --red:#B9372A; --red-soft:#F8E1DD;
  --studio-a:#FBF8F2; --studio-b:#DCD3C4; --part:#2A332E; --part-fill:#C9CEC5;
  --bezel:#262824; --page:#E9E3D8; --shadow:rgba(52,40,20,.16);
  --display:'Archivo','Hind Vadodara','Hind',sans-serif; --body:'IBM Plex Sans','Hind Vadodara','Hind',system-ui,sans-serif; --mono:'IBM Plex Mono','Hind Vadodara','Hind',ui-monospace,monospace;
}
[data-theme="dark"]{
  --paper:#141613; --surface:#1E211D; --ink:#ECE9E2; --ink-2:#C4C1B9; --ink-3:#8F8C85; --line:#34382F; --line-2:#292C26;
  --enamel:#8CCDA9; --enamel-bg:#245C45; --on-enamel:#ECE9E2; --enamel-soft:#1C3229;
  --signal:#FF7C40; --signal-ink:#1A0E07; --signal-soft:#3B2418;
  --red:#F07B6B; --red-soft:#3A221E;
  --studio-a:#2E322C; --studio-b:#191B17; --part:#DADDD4; --part-fill:#4B5149;
  --bezel:#050605; --page:#0E100D; --shadow:rgba(0,0,0,.5);
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--body);background:var(--page);color:var(--ink);-webkit-font-smoothing:antialiased;line-height:1.45}
.ic{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
:focus-visible{outline:2px solid var(--signal);outline-offset:2px}
.mono{font-family:var(--mono)}

/* page chrome */
.top{position:sticky;top:0;z-index:20;background:var(--paper);border-bottom:1px solid var(--line)}
.top-in{max-width:1500px;margin:0 auto;padding:10px 24px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-family:var(--display);font-stretch:112%;font-weight:800;font-size:19px;letter-spacing:-.2px}
.dirtag{font:600 11px var(--mono);letter-spacing:.6px;text-transform:uppercase;color:var(--signal);border:1.5px solid var(--signal);border-radius:999px;padding:2px 8px}
.top nav{display:flex;gap:4px;flex-wrap:wrap;flex:1}
.top nav a{color:var(--ink-2);text-decoration:none;font-size:13.5px;padding:6px 11px;border-radius:999px}
.top nav a:hover{background:var(--line-2);color:var(--ink)}
.other{font-size:13px;color:var(--enamel);font-weight:600;text-decoration:none;white-space:nowrap}
.themes{display:flex;background:var(--line-2);border-radius:999px;padding:3px}
.themes button{background:none;border:0;color:var(--ink-2);font:500 13px var(--body);padding:5px 12px;cursor:pointer;border-radius:999px}
.themes button.on{background:var(--ink);color:var(--paper)}
.intro{background:var(--enamel-bg);color:var(--on-enamel)}
.intro-in{max-width:1500px;margin:0 auto;padding:48px 24px 44px;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:40px;align-items:center}
.eyebrow{font:600 12px var(--mono);letter-spacing:1px;text-transform:uppercase;opacity:.75}
.intro h1{font-family:var(--display);font-stretch:115%;font-weight:800;font-size:52px;line-height:1;letter-spacing:-1px;max-width:15ch;margin-top:10px}
.intro p{opacity:.85;max-width:62ch;margin-top:16px;font-size:16.5px}
.system{background:var(--surface);color:var(--ink);border-radius:22px;padding:20px;display:grid;gap:16px;box-shadow:0 20px 40px -24px rgba(0,0,0,.45)}
.sw-row{display:flex;gap:10px;flex-wrap:wrap}
.swatch{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--ink-2);min-width:84px}
.swatch i{display:block;height:40px;border-radius:12px;border:1px solid var(--line)}
.swatch small{font-family:var(--mono);font-size:11px;color:var(--ink-3)}
.legend-side{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--ink-2)}
.typespec{display:flex;gap:18px;align-items:baseline;flex-wrap:wrap}
.typespec b{font-family:var(--display);font-stretch:115%;font-size:30px;font-weight:800}
.typespec .mono{font-size:17px;font-weight:500}
.typespec span{font-size:14px;color:var(--ink-2)}
.flow{max-width:1500px;margin:0 auto;padding:52px 24px 12px}
.flow-head{max-width:860px;margin-bottom:24px;display:grid;grid-template-columns:auto 1fr;gap:4px 16px}
.flow-head h2{grid-column:1/3;font-family:var(--display);font-stretch:112%;font-weight:800;font-size:34px;line-height:1.05;letter-spacing:-.6px;display:flex;gap:14px;align-items:center}
.fn{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:50%;background:var(--enamel-bg);color:var(--on-enamel);font:600 18px var(--mono);letter-spacing:0}
.scope{grid-column:1/3;font:500 12.5px var(--mono);color:var(--signal);margin:4px 0 0 58px}
.flow-head p:last-child{grid-column:1/3;color:var(--ink-2);margin-left:58px;max-width:70ch}
.shots{display:flex;flex-wrap:wrap;gap:30px 24px}
.shot{width:300px}
.shot.wide{width:100%}
figcaption{display:flex;gap:10px;margin-top:12px;font-size:14px;align-items:baseline}
figcaption .num{font:500 12.5px var(--mono);color:var(--signal);min-width:34px}
figcaption small{display:block;color:var(--ink-3);font-size:13px}

/* phone */
.phone{position:relative;width:300px;height:640px;border-radius:40px;border:7px solid var(--bezel);background:var(--paper);overflow:hidden;display:flex;flex-direction:column;box-shadow:0 26px 50px -28px var(--shadow),0 2px 0 1px rgba(255,255,255,.04) inset;font-size:13px}
.statusbar{display:flex;justify-content:space-between;align-items:center;padding:9px 22px 4px;font:600 12px var(--mono);background:var(--paper)}
.sb-r{display:flex;gap:3px;align-items:end}.sb-r i{width:3px;background:var(--ink);border-radius:1px}.sb-r i:nth-child(1){height:5px}.sb-r i:nth-child(2){height:7px}.sb-r i:nth-child(3){height:9px}.sb-r em{width:18px;height:9px;border:1.5px solid var(--ink);border-radius:3px;margin-left:4px}
.screen{flex:1;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;position:relative}
.screen::-webkit-scrollbar{display:none}
.appbar{display:flex;align-items:center;gap:6px;padding:6px 10px 8px;background:var(--paper);position:sticky;top:0;z-index:3;min-height:50px}
.appbar-t{flex:1;min-width:0}.appbar h3{font-family:var(--display);font-stretch:108%;font-size:18px;font-weight:700;line-height:1.15;letter-spacing:-.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.appbar p{font-size:12px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.iconbtn{width:36px;height:36px;display:inline-grid;place-items:center;border-radius:50%;color:var(--ink);position:relative;flex:none;background:var(--surface);box-shadow:0 1px 0 var(--line)}
.iconbtn .ic{width:19px;height:19px}
.iconbtn.light{background:rgba(255,255,255,.94);color:#1C1E1B}
.iconbtn .dot{position:absolute;top:7px;right:8px;width:8px;height:8px;border-radius:50%;background:var(--signal);border:2px solid var(--surface)}
.iconbtn.send{background:var(--signal);color:var(--signal-ink);box-shadow:none}
.tabbar{display:flex;align-items:center;margin:0 10px 10px;padding:6px 6px;border-radius:24px;background:var(--ink);color:var(--paper)}
[data-theme="dark"] .tabbar{background:#2A2D27}
.tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;color:var(--ink-3);font-size:10px}
[data-theme="dark"] .tab{color:#9A978F}
.tab b{font-weight:500}.tab .ic{width:20px;height:20px}
.tab.on{color:var(--paper)}[data-theme="dark"] .tab.on{color:#fff}
.tab.on b{font-weight:600}
.tab.on .ic{stroke-width:2.1;color:var(--signal)}
.tab.sell{margin-top:-24px}
.tab.sell .ic{width:48px;height:48px;padding:12px;border-radius:50%;background:var(--signal);color:var(--signal-ink);border:4px solid var(--paper);stroke-width:2.2}
.pad{padding:14px}.pad-x{margin:10px 14px 6px}
.h1{font-family:var(--display);font-stretch:110%;font-weight:800;font-size:24px;line-height:1.08;letter-spacing:-.5px}
.lead{color:var(--ink-2);margin-top:6px;font-size:14px}
.fine{color:var(--ink-3);font-size:12px;margin-top:10px}
.link{color:var(--enamel);font-weight:600;text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}.link.sm{font-size:13px}
.sec{font-family:var(--display);font-stretch:108%;font-weight:700;font-size:16px;letter-spacing:-.2px;margin:18px 14px 8px;display:flex;align-items:center;gap:8px}
.sec::after{content:"";flex:1;height:1px;background:var(--line)}

/* buttons, fields */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:48px;padding:0 18px;border-radius:999px;font-weight:600;font-size:15px;background:var(--signal);color:var(--signal-ink);flex:1;white-space:nowrap}
.btn .ic{width:18px;height:18px}
.btn.ghost{background:transparent;color:var(--enamel);box-shadow:inset 0 0 0 1.5px var(--enamel)}
.footbar .btn{padding:0 10px;font-size:14px;min-width:0}
.footbar{display:flex;gap:8px;padding:10px 12px 12px;background:linear-gradient(to top,var(--paper) 70%,transparent);position:sticky;bottom:0;z-index:3}
.form{display:flex;flex-direction:column;gap:14px}
.field{display:flex;flex-direction:column;gap:5px}
.f-l{font-size:11.5px;font-weight:600;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px}
.f-v{display:flex;justify-content:space-between;align-items:center;min-height:46px;padding:10px 14px;border-radius:14px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);font-size:15px}
.f-v em{font-style:normal;color:var(--ink-3);font-family:var(--mono);font-size:13px}
.f-v.empty{color:var(--ink-3)}
.f-h{font-size:12px;color:var(--ink-3)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 13px;border-radius:999px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);font-size:13px;white-space:nowrap}
.chip .ic{width:15px;height:15px}
.chip.on{background:var(--enamel-bg);color:var(--on-enamel);box-shadow:none}
.segmented{display:flex;gap:4px}
.segmented span{flex:1 1 auto;text-align:center;padding:7px 6px;border-radius:999px;font-size:12px;color:var(--ink-2);white-space:nowrap;box-shadow:inset 0 0 0 1px var(--line);background:var(--surface)}
.segmented span.on{background:var(--ink);color:var(--paper);font-weight:600;box-shadow:none}
.segmented.big span{padding:11px 4px;font-size:14px}
.steps{padding:4px 14px 6px;background:var(--paper);font:500 11.5px var(--mono);color:var(--ink-3);display:flex;align-items:center;gap:10px;flex-direction:row-reverse;justify-content:flex-end}
.steps-bar{display:flex;gap:4px;flex:none}.steps span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.steps-bar i{width:7px;height:7px;border-radius:50%;background:var(--line)}.steps-bar i.fill{background:var(--signal)}
.callout{display:flex;gap:10px;padding:12px 14px;border-radius:16px;background:var(--enamel-soft);font-size:13px;color:var(--ink)}
.callout .ic{color:var(--enamel);margin-top:1px}
.callout.soft{background:var(--surface);box-shadow:inset 0 0 0 1px var(--line)}
.badge{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;padding:2px 8px 2px 6px;border-radius:999px;margin-top:4px;width:max-content}
.badge .ic{width:13px;height:13px;stroke-width:2.2}
.badge.ok{background:var(--enamel-soft);color:var(--enamel)}
.pill{font-style:normal;font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;background:var(--signal-soft);color:var(--signal);white-space:nowrap}
.pill.ok{background:var(--enamel-soft);color:var(--enamel)}
.st{font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;background:var(--line-2);color:var(--ink-2);white-space:nowrap}
.st.wait{background:var(--signal-soft);color:var(--signal)}.st.new{background:var(--signal);color:var(--signal-ink)}.st.ok{background:var(--enamel-soft);color:var(--enamel)}

/* the side token: L | R. Filled = has it, orange dashed = needed, grey = already have, dashed = not part of it */
.side{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--ink);vertical-align:middle}
.sd{display:inline-flex}
.sd i{font:600 11px/1 var(--mono);font-style:normal;width:21px;height:20px;display:grid;place-items:center;border:1.5px solid var(--ink-3)}
.sd i:first-child{border-radius:10px 0 0 10px}
.sd i:last-child{border-radius:0 10px 10px 0;margin-left:-1.5px}
.sd i.on{background:var(--enamel-bg);border-color:var(--enamel-bg);color:var(--on-enamel);position:relative}
.sd i.off{border-style:dashed;color:var(--ink-3);opacity:.55}
.sd i.have{background:var(--line);border-color:var(--line);color:var(--ink-2)}
.sd i.need{border-style:dashed;border-color:var(--signal);color:var(--signal);background:var(--signal-soft);position:relative}
.side.lg .sd i{width:28px;height:26px;font-size:13px}.side.lg .sd i:first-child{border-radius:13px 0 0 13px}.side.lg .sd i:last-child{border-radius:0 13px 13px 0}
.side.xl .sd i{width:42px;height:38px;font-size:18px;border-width:2px}.side.xl .sd i:first-child{border-radius:19px 0 0 19px}.side.xl .sd i:last-child{border-radius:0 19px 19px 0;margin-left:-2px}
.sd.none i{width:70px!important;border-radius:19px!important;border-style:dashed;color:var(--ink-3)}

/* thumbs: parts lit like product photos on a studio sweep */
.phone .thumb,.desk .thumb{flex:none}
.thumb{width:84px;height:84px;flex:none;border-radius:16px;background:radial-gradient(110% 85% at 50% 18%,var(--studio-a),var(--studio-b));display:grid;place-items:center;overflow:hidden}
.thumb svg{width:74%;height:74%;fill:var(--part-fill);stroke:var(--part);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 5px 3px rgba(40,28,10,.25))}
.thumb.sm{width:52px;height:52px;border-radius:12px}.thumb.xs{width:40px;height:40px;border-radius:10px}
.thumb.big{width:160px;height:160px;border-radius:50%}
.thumb.hero{width:100%;height:100%;border-radius:0}
.thumb.hero svg{width:58%;height:58%;stroke-width:1.6;filter:drop-shadow(0 14px 8px rgba(40,28,10,.25))}
.thumb.need{background:var(--signal-soft);box-shadow:inset 0 0 0 2px var(--signal)}
.thumb.need svg{fill:none;stroke:var(--signal);stroke-dasharray:4 4;filter:none}

/* listing card: list row by default, photo-first tile inside .lgrid */
.listing{position:relative;display:flex;gap:12px;padding:10px;margin:0 10px 8px;background:var(--surface);border-radius:20px;box-shadow:0 1px 0 var(--line),0 8px 18px -14px var(--shadow)}
.l-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;padding-top:2px}
.listing h4{font-size:14px;font-weight:600;line-height:1.22}
.compat{font-size:12px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.l-tags{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.cond,.qty{font-size:11px;font-weight:500;padding:2px 8px;border-radius:999px;background:var(--line-2);color:var(--ink-2)}
.l-foot{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:2px 8px;margin-top:2px}
.price{font-family:var(--mono);font-weight:600;font-size:15.5px;line-height:1.1;white-space:nowrap;letter-spacing:-.3px}
.price.xl{font-size:26px;margin-top:4px;letter-spacing:-1px}.price small{font-family:var(--body);font-size:13px;font-weight:400;color:var(--ink-3);letter-spacing:0}
.place{display:flex;align-items:center;gap:3px;font-size:11.5px;color:var(--ink-3);min-width:0;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.place .ic{width:12px;height:12px}.place em{font-style:normal;font-weight:600;color:var(--enamel)}
.ltag{position:absolute;top:10px;left:10px;font-size:10.5px;font-weight:600;background:var(--signal);color:var(--signal-ink);padding:2px 8px;border-radius:999px}
.listing.has-tag .thumb{padding-top:10px}
.lgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 10px 4px}
.lgrid>*{min-width:0}
.lgrid .listing{flex-direction:column;margin:0;padding:6px 6px 10px;gap:6px;border-radius:18px}
.lgrid .thumb{width:100%;height:96px;border-radius:13px}
.lgrid .l-body{padding:0 4px}
.lgrid .listing h4{font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.lgrid .l-foot{flex-direction:column;align-items:flex-start}
.lgrid .ltag{top:12px;left:12px}

/* screens */
.welcome{min-height:100%;display:flex;flex-direction:column;gap:12px;padding:20px 22px 22px;background:var(--paper)}
.w-art{display:flex;flex-direction:column;align-items:center;gap:16px;padding:18px 0 8px}
.welcome h1{font-family:var(--display);font-stretch:115%;font-size:31px;line-height:1.02;font-weight:800;letter-spacing:-1px}
.welcome p{color:var(--ink-2);font-size:14.5px;margin-bottom:8px}
.welcome .btn{flex:none}.welcome .link{text-align:center;padding:8px}
.lang{display:flex;align-items:center;justify-content:center;gap:6px;font-size:12.5px;color:var(--ink-3);margin-top:auto}
.phonefield{display:flex;margin-top:22px;border-radius:16px;overflow:hidden;font:500 22px var(--mono);background:var(--surface);box-shadow:inset 0 0 0 2px var(--enamel)}
.phonefield span{padding:12px 14px;color:var(--ink-3);background:var(--line-2)}.phonefield b{padding:12px 14px;font-weight:500;letter-spacing:.5px}
.otp{display:flex;gap:7px;margin-top:22px}.otp i{flex:1;height:54px;border-radius:14px;display:grid;place-items:center;font:500 24px var(--mono);font-style:normal;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line)}
.otp i.cur{box-shadow:inset 0 0 0 2px var(--signal)}
.mapbox,.bigmap{position:relative;height:124px;border-radius:18px;background:var(--enamel-soft);background-image:radial-gradient(circle at 30% 40%,transparent 0 30px,rgba(31,86,65,.08) 31px 33px,transparent 34px),repeating-linear-gradient(35deg,transparent 0 22px,rgba(31,86,65,.10) 22px 24px),repeating-linear-gradient(-55deg,transparent 0 34px,rgba(31,86,65,.08) 34px 36px);display:flex;align-items:center;justify-content:center;gap:4px;font-weight:600}
.mappin{width:26px;height:26px;color:var(--signal)}
.gstcard{padding:14px;border-radius:18px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);display:flex;flex-direction:column;gap:2px}
.gstcard h4{font-size:15px}.gstcard p{font-size:12.5px;color:var(--ink-2)}
.homehead{background:var(--enamel-bg);color:var(--on-enamel);padding-bottom:16px;border-radius:0 0 26px 26px;margin-bottom:6px}
.home-top{display:flex;align-items:center;gap:8px;padding:6px 12px 10px}
.homehead .iconbtn{background:rgba(255,255,255,.12);color:var(--on-enamel);box-shadow:none}
.homehead .iconbtn .dot{border-color:var(--enamel-bg)}
.loc{flex:1;display:flex;align-items:center;gap:6px}.loc>span{display:flex;flex-direction:column;line-height:1.15}.loc small{opacity:.75;font-size:11.5px}
.searchbar{display:flex;align-items:center;gap:8px;margin:0 12px;padding:0 14px;height:46px;border-radius:999px;background:var(--surface);color:var(--ink-3);box-shadow:inset 0 0 0 1px var(--line)}
.homehead .searchbar{box-shadow:none}
.searchbar.flat{margin:8px 14px}
.searchbar.in{flex:1;margin:0;color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--enamel)}
.searchtop{display:flex;gap:6px;align-items:center;padding:6px 10px;background:var(--paper)}
.cats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 6px;padding:6px 12px 0}
.cat{display:flex;flex-direction:column;align-items:center;text-align:center;gap:5px;font-size:12px;font-weight:500;line-height:1.1;min-width:0}
.cat .thumb{width:58px;height:58px;border-radius:50%}
.sidematch{display:flex;align-items:center;gap:10px;margin:14px 12px 0;padding:12px 14px;border-radius:18px;background:var(--surface);box-shadow:inset 0 0 0 1.5px var(--signal);color:var(--ink)}
.sidematch div{flex:1;display:flex;flex-direction:column;line-height:1.25;font-size:13px}.sidematch small{color:var(--ink-3);font-size:11.5px;margin-top:2px}
.sidematch>.ic{color:var(--signal)}
.hscroll{display:flex;gap:8px;padding:0 12px 16px;overflow:hidden}
.mini{width:140px;flex:none;background:var(--surface);border-radius:18px;padding:6px 6px 10px;display:flex;flex-direction:column;gap:3px;font-size:12.5px;box-shadow:0 1px 0 var(--line)}
.mini .thumb{width:100%;height:80px;border-radius:13px}.mini b,.mini span{padding:0 4px}.mini span{font:600 14px var(--mono)}
.crumbs{display:flex;align-items:center;gap:3px;padding:8px 14px;font-size:12.5px;color:var(--ink-3);flex-wrap:wrap}.crumbs .ic{width:13px;height:13px}.crumbs b{color:var(--enamel)}
.tree{background:var(--surface);margin:0 10px;border-radius:18px;overflow:hidden;box-shadow:0 1px 0 var(--line)}
.tree-row{display:flex;align-items:center;gap:8px;padding:13px 14px;border-bottom:1px solid var(--line-2);font-size:14.5px}
.tree-row:last-child{border-bottom:0}
.tree-row span{flex:1}.tree-row em{font:500 12px var(--mono);color:var(--ink-3)}.tree-row .ic{color:var(--ink-3);width:16px}
.tree-row.on{background:var(--enamel-soft);font-weight:600}.tree-row.on .ic{color:var(--enamel)}
.tree+.sec+.chips{padding:0 14px}
.filterrow{display:flex;gap:6px;padding:6px 12px 10px;overflow:hidden;background:var(--paper)}
.count{font:500 11.5px var(--mono);color:var(--ink-3);padding:4px 14px 8px}
.sidepick{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.sp .side{gap:4px;font-size:11.5px}.sp .sd i{width:18px}
.sp{display:flex;justify-content:center;padding:10px 2px;border-radius:14px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line)}
.sp.on{box-shadow:inset 0 0 0 2px var(--enamel);background:var(--enamel-soft)}
.range{position:relative;height:6px;border-radius:3px;background:var(--line);margin:12px 6px}.range i{position:absolute;inset:0 auto 0 0;background:var(--enamel);border-radius:3px}.range b{position:absolute;top:-8px;width:22px;height:22px;margin-left:-11px;border-radius:50%;background:var(--surface);box-shadow:0 0 0 2px var(--enamel),0 2px 6px var(--shadow)}
.filters .two .f-l{display:none}
.bigmap{height:230px;border-radius:0 0 26px 26px}
.pinm{position:absolute;min-width:32px;height:32px;padding:0 7px;border-radius:16px 16px 16px 4px;background:var(--surface);color:var(--enamel);display:grid;place-items:center;font:600 13px var(--mono);box-shadow:0 4px 10px -4px var(--shadow)}
.pinm.me{left:46%;top:44%;border-radius:50%;background:var(--signal);color:var(--signal-ink);box-shadow:0 0 0 10px rgba(221,81,25,.18)}
.pinm.me .ic{width:15px;height:15px}
.maplabel{position:absolute;font-size:11px;font-weight:600;color:var(--enamel)}
.arealist{margin-top:12px;background:var(--surface);border-radius:18px;overflow:hidden;box-shadow:0 1px 0 var(--line)}
.arealist div{display:grid;grid-template-columns:1fr auto;padding:11px 14px;border-bottom:1px solid var(--line-2)}
.arealist div:last-child{border-bottom:0}
.arealist span{grid-column:1;font-size:12px;color:var(--ink-3)}.arealist em{grid-row:1/3;grid-column:2;align-self:center;font:600 14px var(--mono);color:var(--enamel)}
.gallery{position:relative;height:260px;background:var(--studio-b)}.gallery.short{height:170px}
.gal-n{position:absolute;bottom:32px;right:12px;background:rgba(28,30,27,.8);color:#fff;font:500 11.5px var(--mono);padding:3px 9px;border-radius:999px}
.gal-v{position:absolute;bottom:32px;left:12px;display:flex;gap:4px;align-items:center;background:var(--signal);color:var(--signal-ink);font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px}.gal-v .ic{width:14px;height:14px}
.gal-top{position:absolute;top:8px;left:10px;right:10px;display:flex;justify-content:space-between}.gal-top>span{display:flex;gap:6px}
.detail{display:flex;flex-direction:column;gap:10px;background:var(--paper);border-radius:24px 24px 0 0;margin-top:-20px;position:relative}
.fits{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:12px;border-radius:18px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);font-size:12.5px}
.fits b{width:100%;font-size:11px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px}
.fits span:not(.link){padding:4px 10px;background:var(--enamel-soft);color:var(--enamel);border-radius:999px;font-weight:600}
.other-side{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:18px;background:var(--signal-soft);color:var(--ink)}
.other-side div{flex:1;display:flex;flex-direction:column;font-size:13px;line-height:1.25}.other-side small{color:var(--ink-2)}.other-side>.ic{color:var(--signal)}
.specs{display:grid;grid-template-columns:auto 1fr;border-radius:16px;overflow:hidden;font-size:13px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line)}
.specs dt,.specs dd{padding:9px 12px;border-bottom:1px dashed var(--line)}
.specs dt{color:var(--ink-3);font-size:12px}
.specs dd{font-family:var(--mono);font-size:12.5px;font-weight:500;text-align:right}
.specs dt:nth-last-of-type(1),.specs dd:last-child{border-bottom:0}
.seller{display:flex;gap:10px;align-items:center;padding:10px;border-radius:18px;background:var(--surface);margin-top:2px;box-shadow:inset 0 0 0 1px var(--line)}
.seller .thumb{border-radius:50%}
.seller>div:nth-child(2){flex:1;display:flex;flex-direction:column;font-size:12.5px;line-height:1.25}.seller span{color:var(--ink-3)}
.sr{text-align:right;display:flex;flex-direction:column;line-height:1.1}.sr b{font:600 18px var(--mono)}.sr small{font-size:11px;color:var(--ink-3)}
.pairing{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:14px;border-radius:18px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line)}
.pairing .plus{font:600 22px var(--mono);color:var(--ink-3)}.pairing p{width:100%;font-size:13px;color:var(--ink-2)}
.sp-head{display:flex;gap:12px;align-items:center}.sp-head .thumb{border-radius:50%}.sp-head p{color:var(--ink-3);font-size:13px}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:14px 0}
.kpis div{background:var(--surface);border-radius:16px;padding:10px;display:flex;flex-direction:column;box-shadow:0 1px 0 var(--line)}
.kpis b{font:600 19px var(--mono);letter-spacing:-.5px}.kpis span{font-size:11px;color:var(--ink-3)}
.choice{display:flex;align-items:center;gap:12px;padding:10px;border-radius:18px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line)}
.choice>div{flex:1;display:flex;flex-direction:column;line-height:1.25}.choice span{font-size:12.5px;color:var(--ink-3)}
.choice>.ic{width:22px;height:22px;color:var(--enamel);margin-left:6px}
.choice.on{box-shadow:inset 0 0 0 2px var(--enamel);background:var(--enamel-soft)}
.radio{width:22px;height:22px;border-radius:50%;box-shadow:inset 0 0 0 2px var(--line);flex:none}
.choice.on .radio{box-shadow:inset 0 0 0 7px var(--enamel)}
.conds{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.cnd{padding:10px 12px;border-radius:16px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);display:flex;flex-direction:column;line-height:1.2}
.cnd span{font-size:11.5px;color:var(--ink-3)}.cnd.on{box-shadow:inset 0 0 0 2px var(--enamel);background:var(--enamel-soft)}
.fitlist{display:flex;flex-direction:column;gap:6px}
.fitlist span{display:flex;align-items:center;gap:6px;padding:9px 12px;border-radius:999px;background:var(--enamel-soft);color:var(--enamel);font-weight:600}
.fitlist em{font:400 12px var(--mono);color:var(--ink-2);flex:1}.fitlist .ic{width:15px}
.sidebig{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:6px 0}
.sb{display:flex;flex-direction:column;align-items:center;gap:10px;padding:18px 8px;border-radius:20px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);font-size:13.5px}
.sb.on{box-shadow:inset 0 0 0 2.5px var(--enamel);background:var(--enamel-soft)}
.photos{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.ph{position:relative;aspect-ratio:1}.ph .thumb{width:100%;height:100%}
.ph.main span{position:absolute;bottom:6px;left:6px;font-size:10.5px;font-weight:600;background:var(--signal);color:var(--signal-ink);padding:1px 7px;border-radius:999px}
.ph.add{border:1.5px dashed var(--ink-3);border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:11.5px;color:var(--ink-2)}
.tips{display:flex;flex-direction:column;gap:6px;padding:14px;border-radius:18px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);font-size:13px}
.tips span{display:flex;gap:6px;align-items:center;color:var(--ink-2)}.tips .ic{color:var(--enamel);width:16px}
.previewnote{display:flex;gap:6px;align-items:center;padding:8px 14px;background:var(--signal-soft);font-size:12.5px}
.checklist{display:flex;flex-direction:column;gap:5px;font-size:13px}
.checklist span{display:flex;gap:6px;align-items:center}.checklist .ic{width:16px;color:var(--enamel)}.checklist .warn .ic{color:var(--signal)}
.done{min-height:100%;display:flex;flex-direction:column;gap:12px;padding:44px 20px 20px;background:var(--paper)}
.done-mark{width:76px;height:76px;border-radius:50%;background:var(--enamel-bg);color:var(--on-enamel);display:grid;place-items:center;box-shadow:0 0 0 10px var(--enamel-soft)}
.done-mark .ic{width:38px;height:38px;stroke-width:2.4}
.done .btn{flex:none}
.matchnote{display:flex;gap:10px;align-items:center;padding:12px 14px;border-radius:18px;background:var(--signal-soft);font-size:13px;margin:6px 0}
.dim{height:100%;filter:saturate(.5) brightness(.97)}
.dim .listing{margin-top:12px}
.scrim{position:absolute;inset:0;background:rgba(20,22,18,.48);z-index:5}
.sheet{position:absolute;left:6px;right:6px;bottom:6px;z-index:6;background:var(--paper);border-radius:28px;padding:8px 14px 16px;display:flex;flex-direction:column;gap:10px;max-height:86%;overflow:auto}
.sheet h3{font-family:var(--display);font-stretch:110%;font-size:20px;font-weight:800;letter-spacing:-.4px}
.sheet .btn{flex:none}
.grab{width:40px;height:4px;border-radius:2px;background:var(--line);margin:0 auto 4px}
.quick{display:flex;flex-wrap:wrap;gap:6px}
.quick span{padding:8px 12px;border-radius:999px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);font-size:13px}
.quick span.on{background:var(--enamel-bg);color:var(--on-enamel);box-shadow:none}
.chat{display:flex;flex-direction:column;gap:8px;padding:12px}
.msg{max-width:82%;padding:9px 12px;border-radius:18px 18px 18px 6px;background:var(--surface);font-size:13.5px;box-shadow:0 1px 0 var(--line)}
.msg small{display:block;text-align:right;font:400 10.5px var(--mono);color:var(--ink-3)}
.msg.me{align-self:flex-end;background:var(--enamel-bg);color:var(--on-enamel);border-radius:18px 18px 6px 18px;box-shadow:none}
.msg.me small{color:var(--on-enamel);opacity:.65}
.msg.media{display:flex;gap:5px;flex-wrap:wrap}.msg.media small{width:100%}
.offer{border-radius:20px;background:var(--surface);overflow:hidden;font-size:13px;box-shadow:inset 0 0 0 1.5px var(--signal)}
.offer.mine{align-self:flex-end;width:88%;box-shadow:inset 0 0 0 1.5px var(--enamel)}
.o-h{display:flex;justify-content:space-between;align-items:center;padding:10px 12px 6px}
.o-r{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:4px 12px;border-top:1px dashed var(--line)}
.o-r span{color:var(--ink-3)}.o-r b{font:600 15px var(--mono)}.o-r em{font-style:normal;font-size:11.5px;color:var(--signal);flex:1;text-align:right}
.offer small,.offer p{display:block;padding:4px 12px 10px;color:var(--ink-3);font-size:12px}
.o-act{display:flex;gap:6px;padding:8px}.o-act .btn{height:40px;font-size:13.5px;padding:0 8px}
.sys{align-self:center;font-size:12px;color:var(--ink-2);background:var(--line-2);padding:5px 12px;border-radius:999px;text-align:center}
.dealcard{display:flex;gap:10px;align-items:center;padding:12px 14px;border-radius:18px;background:var(--enamel-bg);color:var(--on-enamel)}
.dealcard div{flex:1;display:flex;flex-direction:column;line-height:1.25}.dealcard span{font-size:12.5px;opacity:.8}
.composer{position:sticky;bottom:0;display:flex;align-items:center;gap:4px;padding:8px;background:var(--paper);margin-top:auto}
.cin{flex:1;height:40px;border-radius:20px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);padding:0 14px;display:flex;align-items:center;color:var(--ink-3)}
.offerform{display:flex;flex-direction:column;gap:10px}
.asked{display:flex;justify-content:space-between;align-items:baseline;padding:12px 14px;border-radius:16px;background:var(--surface)}.asked b{font-family:var(--mono)}
.total{display:flex;justify-content:space-between;align-items:baseline;padding:12px 0 6px;border-top:1.5px dashed var(--ink-3)}
.total b{font:600 21px var(--mono);letter-spacing:-.5px}
.inbox{background:var(--surface);margin:8px 10px 0;border-radius:20px;overflow:hidden;box-shadow:0 1px 0 var(--line)}
.row{display:flex;gap:10px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--line-2)}
.row:last-child{border-bottom:0}
.row>div:nth-child(2){flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25}
.row span{font-size:12.5px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt{display:flex;flex-direction:column;align-items:end;gap:4px}.rt small{font:400 11px var(--mono);color:var(--ink-3)}
.dealhead{display:flex;gap:10px;align-items:center;margin-bottom:12px}
.dealhead div{flex:1;display:flex;flex-direction:column;line-height:1.25}.dealhead div span{font-size:12.5px;color:var(--ink-3)}
.timeline{margin-top:14px;display:flex;flex-direction:column;background:var(--surface);border-radius:18px;padding:6px 14px;box-shadow:0 1px 0 var(--line)}
.timeline div{display:grid;grid-template-columns:22px 1fr auto;align-items:center;gap:8px;position:relative;padding:9px 0}
.timeline div::before{content:"";position:absolute;left:6px;top:26px;bottom:-9px;width:2px;background:var(--line)}
.timeline div:last-child::before{display:none}
.timeline i{width:14px;height:14px;border-radius:50%;box-shadow:inset 0 0 0 2px var(--line);background:var(--surface);z-index:1}
.timeline .ok i{background:var(--enamel-bg);box-shadow:none}
.timeline .ok::before{background:var(--enamel-bg)}
.timeline small{font:400 11.5px var(--mono);color:var(--ink-3)}
.rate{display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:13.5px}
.stars{display:flex;gap:2px}.stars i .ic{width:22px;height:22px;color:var(--line)}.stars i.on .ic{color:var(--signal);fill:var(--signal)}
.reqs,.replies,.reqcards{display:flex;flex-direction:column;gap:8px;padding:8px 10px}
.req{display:flex;gap:10px;align-items:center;padding:12px;background:var(--surface);border-radius:18px;box-shadow:0 1px 0 var(--line)}
.req div{flex:1;display:flex;flex-direction:column;line-height:1.25}.req span{font-size:12.5px;color:var(--ink-3)}
.req em{font-style:normal;font-size:12px;font-weight:600;color:var(--ink-2);margin-top:3px}.req em.m{color:var(--signal)}
.reply{background:var(--surface);border-radius:20px;padding:12px 0 4px;box-shadow:0 1px 0 var(--line)}
.rp-h{display:flex;justify-content:space-between;align-items:center;padding:0 12px 8px;font-size:13.5px}
.rp-h .badge{margin-top:0}
.reply .listing{margin:0 6px 6px;background:var(--paper);box-shadow:none}
.reply p{font-size:12.5px;color:var(--ink-2);padding:0 12px 6px}
.quote{margin:0 12px 8px;padding:12px;border-radius:16px;background:var(--signal-soft);display:flex;flex-direction:column}
.quote span{font-size:11px;color:var(--signal);font-weight:600;text-transform:uppercase;letter-spacing:.5px}.quote b{font:600 17px var(--mono)}.quote small{color:var(--ink-2)}
.rq{display:flex;gap:10px;padding:12px;background:var(--surface);border-radius:18px;box-shadow:0 1px 0 var(--line)}
.rq>div{flex:1;display:flex;flex-direction:column;gap:2px;font-size:12.5px}.rq>div>span{color:var(--ink-3)}
.rq-a{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.rq-a .btn{height:36px;font-size:12.5px;padding:0 10px}
.lock{min-height:100%;padding:40px 12px;background:radial-gradient(120% 80% at 30% 0%,#2F6B52,#0F2219);color:#fff;display:flex;flex-direction:column;gap:10px}
.lock-t{font:500 60px var(--mono);text-align:center;line-height:1;letter-spacing:-3px}.lock-d{text-align:center;opacity:.8;margin-bottom:20px}
.notif{background:rgba(250,247,240,.94);color:#1C1E1B;border-radius:20px;padding:11px 13px;font-size:13px;display:flex;flex-direction:column;gap:2px}
.notif p{color:#4A4E47}.notif.dim2{opacity:.75}
.n-h{display:flex;gap:6px;align-items:center;font-size:11.5px;color:#4A4E47}.n-h b{flex:1}.n-h .ic{width:16px;height:16px;color:#fff;background:#DD5119;border-radius:5px;padding:2px}
.phone.dark .statusbar{background:#2F6B52;color:#fff}.phone.dark .sb-r i{background:#fff}.phone.dark .sb-r em{border-color:#fff}
.rates{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.rates div{border-radius:16px;padding:9px 10px;display:flex;flex-direction:column;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line)}
.rates div:nth-child(2){box-shadow:inset 0 0 0 2px var(--enamel);background:var(--enamel-soft)}
.rates b{font:600 15px var(--mono);letter-spacing:-.4px}.rates span{font-size:11px;color:var(--ink-3)}
.avail b{font-size:11px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px}
.days{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:6px}
.days span{height:28px;display:grid;place-items:center;border-radius:50%;background:var(--enamel-soft);color:var(--enamel);font:600 11px var(--mono)}
.days span.busy{background:transparent;color:var(--ink-3);box-shadow:inset 0 0 0 1px var(--line);text-decoration:line-through}
.needs{background:var(--enamel-bg);color:var(--on-enamel);border-radius:22px;overflow:hidden;padding-bottom:4px}
.needs>b{display:block;padding:12px 14px 6px;font-family:var(--display);font-stretch:110%;font-size:17px;font-weight:800}
.nrow{display:flex;align-items:center;gap:10px;padding:9px 14px;border-top:1px solid rgba(255,255,255,.12);font-size:13.5px}
.nrow span:nth-child(2){flex:1}
.nn{min-width:30px;height:30px;border-radius:50%;background:var(--signal);color:var(--signal-ink);display:grid;place-items:center;font:600 14px var(--mono)}
.actions{display:flex;flex-direction:column;background:var(--surface);border-radius:18px;overflow:hidden}
.actions div{display:flex;gap:12px;align-items:center;padding:13px 14px;border-bottom:1px solid var(--line-2);font-size:14.5px}
.actions .ic{color:var(--enamel)}
.actions .danger{color:var(--red);border-bottom:0}.actions .danger .ic{color:var(--red)}
.notes{display:flex;flex-direction:column;gap:6px;padding:4px 10px}
.note{display:flex;gap:10px;padding:12px;align-items:flex-start;background:var(--surface);border-radius:18px;box-shadow:0 1px 0 var(--line)}
.note div{flex:1;display:flex;flex-direction:column;line-height:1.3}.note span{font-size:12.5px;color:var(--ink-3)}.note small{font:400 11px var(--mono);color:var(--ink-3)}
.ni{width:36px;height:36px;border-radius:50%;background:var(--line-2);display:grid;place-items:center;flex:none;color:var(--ink-2)}
.note.new{box-shadow:inset 3px 0 0 var(--signal),0 1px 0 var(--line)}.note.new .ni{background:var(--signal-soft);color:var(--signal)}
.menu{margin-top:16px;background:var(--surface);border-radius:20px;overflow:hidden;box-shadow:0 1px 0 var(--line)}
.menu div{display:flex;align-items:center;gap:11px;padding:12px 14px;border-bottom:1px solid var(--line-2);font-size:14px}
.menu div:last-child{border-bottom:0}
.menu div>.ic:first-child{color:var(--enamel)}
.menu span{flex:1}.menu em{font-style:normal;color:var(--ink-3);font-size:12.5px}.menu div>.ic:last-child{width:15px;color:var(--ink-3)}
.lang-gu .listing h4,.lang-gu .sidematch b{font-weight:600}

/* admin */
.desk{display:grid;grid-template-columns:236px 1fr;min-height:560px;border-radius:24px;overflow:hidden;background:var(--paper);box-shadow:0 26px 50px -30px var(--shadow),inset 0 0 0 1px var(--line);font-size:13.5px}
.a-side{background:var(--surface);color:var(--ink-2);padding:16px 10px;display:flex;flex-direction:column;gap:1px;border-right:1px solid var(--line)}
.a-logo{display:flex;align-items:center;gap:8px;padding:2px 8px 16px;color:var(--ink);font-family:var(--display);font-stretch:112%;font-weight:800;font-size:15px}
.a-logo small{font:600 10px var(--mono);color:var(--signal);margin-left:auto;text-transform:uppercase;letter-spacing:.6px}
.a-nav{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:999px;font-size:13px}
.a-nav span{flex:1}.a-nav .ic{width:16px;height:16px}
.a-nav em{font:600 11px var(--mono);font-style:normal;background:var(--signal);color:var(--signal-ink);border-radius:999px;padding:1px 7px}
.a-nav.on{background:var(--enamel-bg);color:var(--on-enamel);font-weight:600}
.a-main{padding:20px 24px;display:flex;flex-direction:column;gap:16px;min-width:0}
.a-top{display:flex;align-items:center;gap:14px}
.a-top h3{font-family:var(--display);font-stretch:112%;font-size:26px;font-weight:800;letter-spacing:-.6px;flex:1}
.a-search{display:flex;gap:8px;align-items:center;width:330px;height:40px;padding:0 14px;border-radius:999px;background:var(--surface);color:var(--ink-3);box-shadow:inset 0 0 0 1px var(--line)}
.a-me{font-size:12.5px;padding:7px 12px;border-radius:999px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line)}
.a-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.a-kpis div{background:var(--surface);border-radius:18px;padding:14px 16px;display:flex;flex-direction:column;box-shadow:0 1px 0 var(--line)}
.a-kpis span{font-size:12px;color:var(--ink-3)}.a-kpis b{font:600 26px var(--mono);letter-spacing:-1px;line-height:1.2}.a-kpis small{font-size:12px;color:var(--enamel);min-height:16px}
.a-grid{display:grid;grid-template-columns:1.3fr 1fr;gap:12px}
.a-card{background:var(--surface);border-radius:18px;padding:16px;box-shadow:0 1px 0 var(--line)}
.a-card h4{font-size:14px;margin-bottom:12px}
.bars{display:flex;align-items:end;gap:14px;height:150px;padding:0 6px;border-bottom:1px solid var(--line)}
.bars i{flex:1;background:var(--line-2);border-radius:8px 8px 0 0;position:relative;display:flex;align-items:end}
.bars em{display:block;width:100%;background:var(--enamel-bg);border-radius:8px 8px 0 0}
.legend{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--ink-3);margin-top:8px}
.legend span{width:10px;height:10px;border-radius:50%;display:inline-block;margin-left:8px}.lg1{background:var(--line)}.lg2{background:var(--enamel-bg)}
.hbar{display:grid;grid-template-columns:170px 1fr 44px;gap:8px;align-items:center;padding:6px 0;font-size:12.5px}
.hbar i{height:8px;border-radius:4px;background:var(--signal)}.hbar b{text-align:right;font:500 13px var(--mono)}
.a-split{display:grid;grid-template-columns:300px 1fr;gap:12px;align-items:start}
.a-queue,.a-tree{background:var(--surface);border-radius:18px;overflow:hidden;box-shadow:0 1px 0 var(--line)}
.q{display:flex;gap:10px;align-items:center;padding:11px 12px;border-bottom:1px solid var(--line-2)}
.q div{flex:1;display:flex;flex-direction:column;line-height:1.25;min-width:0}.q span{font-size:12px;color:var(--ink-3)}
.q.on{background:var(--enamel-soft);box-shadow:inset 3px 0 0 var(--enamel)}
.a-review{background:var(--surface);border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:12px;box-shadow:0 1px 0 var(--line)}
.a-review h4{font-family:var(--display);font-stretch:110%;font-size:20px;font-weight:800;letter-spacing:-.4px}
.a-rh{display:flex;gap:12px;align-items:center}.a-rh div{flex:1}.a-rh p{font-size:12.5px;color:var(--ink-3)}
.a-photos{display:flex;gap:6px}
.a-act{display:flex;gap:8px;justify-content:flex-end}.a-act .btn{flex:none;height:40px;font-size:14px}
.tn{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--line-2);font-size:13px}
.tn .ic{width:14px;height:14px;color:var(--ink-3)}.tn.on{background:var(--enamel-soft);color:var(--enamel);font-weight:600;box-shadow:inset 3px 0 0 var(--enamel)}
.muted{color:var(--ink-3);font-size:12.5px}
.a-fields{border-radius:14px;overflow:hidden;box-shadow:inset 0 0 0 1px var(--line)}
.a-fields div{display:grid;grid-template-columns:1.4fr 1fr 80px;padding:8px 12px;border-bottom:1px dashed var(--line);font-size:13px}
.a-fields div:last-child{border-bottom:0}
.a-fields .af-h{background:var(--line-2);font-weight:600;color:var(--ink-3);font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:0}
.a-toggle{display:flex;gap:12px;align-items:flex-start;padding:14px;border-radius:16px;background:var(--signal-soft)}
.a-toggle div{display:flex;flex-direction:column}.a-toggle small{color:var(--ink-2);font-size:12.5px}
.sw{width:40px;height:24px;border-radius:12px;background:var(--line);position:relative;flex:none}
.sw::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff}
.sw.on{background:var(--enamel-bg)}.sw.on::after{left:19px}
.a-compare{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.a-compare>div{display:flex;flex-direction:column;gap:6px}

.decisions{max-width:1500px;margin:0 auto;padding:44px 24px 80px}
.decisions h2{font-family:var(--display);font-stretch:112%;font-weight:800;font-size:34px;letter-spacing:-.6px;margin-bottom:14px}
.decisions ol{max-width:80ch;padding-left:22px;display:flex;flex-direction:column;gap:8px;color:var(--ink-2)}
.decisions li::marker{font-family:var(--mono);color:var(--signal)}
.decisions b{color:var(--ink)}

@media (max-width:900px){.intro-in{grid-template-columns:1fr}.intro h1{font-size:40px}.flow-head p:last-child,.scope{margin-left:0}.desk{grid-template-columns:1fr}.a-side{display:none}.a-split,.a-grid,.a-compare{grid-template-columns:1fr}.a-kpis{grid-template-columns:1fr 1fr}.a-search{display:none}}
@media (max-width:640px){.top-in,.intro-in,.flow,.decisions{padding-left:16px;padding-right:16px}.shots{justify-content:center}.shot.wide{overflow-x:auto}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

const html = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Machine Parts design B</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,500..800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Hind+Vadodara:wght@400;500;600;700&family=Hind:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
${sprite}
<header class="top"><div class="top-in">
  <span class="brand">${side('pair', { label: false })}Machine Parts</span><span class="dirtag">Direction B</span>
  <nav aria-label="Flows">${nav.map(([id, n]) => `<a href="#${id}">${n}</a>`).join('')}</nav>
  <a class="other" href="user-app-mockup.html">See direction A</a>
  <div class="themes" role="group" aria-label="Theme"><button class="on" data-t="light">Light</button><button data-t="dark">Dark</button></div>
</div></header>

<section class="intro"><div class="intro-in">
  <div>
    <span class="eyebrow">Design direction B · workshop enamel</span>
    <h1>Machine Parts &amp; Machinery Marketplace, app and admin design</h1>
    <p>The same flows and screens as direction A (U1–U4, F1–F9, A1–A6), in a second visual language. It is warmer and closer to a parts catalogue: paper backgrounds, the green enamel paint of Indian machine tools, signal orange for the one action that matters on each screen, parts shown like product photos, prices and part numbers set in a catalogue mono, and an L | R token that shows at a glance which side a part is.</p>
  </div>
  <div class="system" aria-label="Design system">
    <div class="sw-row">
      ${[['Paper', 'var(--paper)', '#F3EFE7'], ['Ink', 'var(--ink)', '#1C1E1B'], ['Machine green', 'var(--enamel-bg)', '#1F5641'], ['Signal orange', 'var(--signal)', '#DD5119'], ['Green tint', 'var(--enamel-soft)', '#E0EBE4'], ['Error', 'var(--red)', '#B9372A']].map(([n, v, h]) => `<span class="swatch"><i style="background:${v}"></i>${n}<small>${h}</small></span>`).join('')}
    </div>
    <div class="typespec"><b>Archivo</b><span class="mono">₹1,150 · 257133100101</span><span>IBM Plex Sans for reading, Plex Mono for numbers, Hind for Gujarati and Hindi</span></div>
    <div class="legend-side">${side('left')}${side('right')}${side('pair')}${side('want-right')}</div>
  </div>
</div></section>

${flows.join('\n')}

<section class="decisions" id="decisions">
  <h2>Decisions needed from the client</h2>
  <ol>
    <li><b>Name and logo.</b> “Machine Parts” is a working name; the L | R token is a placeholder logo.</li>
    <li><b>Visual direction.</b> This is direction B: paper, machine green and signal orange. Direction A (steel, ink and safety yellow) is in <a class="link" href="user-app-mockup.html">user-app-mockup.html</a>. Pick one, or combine them (for example A’s colours with B’s L | R token).</li>
    <li><b>Side convention.</b> “Left” is defined as seen from behind the machine, facing forward (operator’s view). Confirm this matches how your sellers talk about parts.</li>
    <li><b>First listing review.</b> A new seller’s first listing is checked by the team; later ones from verified sellers go live straight away.</li>
    <li><b>Requirement reach.</b> Each requirement goes to up to 15 matching sellers. Raise or lower?</li>
    <li><b>Phone numbers.</b> Hidden until a deal, or until either side chooses to share. Or show them after the first reply?</li>
    <li><b>Rental.</b> Day, week and month rates with a booking request, as shown, or also hourly with operator logs and deposits?</li>
    <li><b>Launch region.</b> Screens use Rajkot and Saurashtra examples. Confirm the first cities and industrial areas.</li>
  </ol>
</section>

<script>
  (function () {
    var root = document.documentElement, btns = document.querySelectorAll('.themes button');
    function set(t) { root.setAttribute('data-theme', t); btns.forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); }); try { localStorage.setItem('mpm-mock-b-theme', t); } catch (e) {} }
    btns.forEach(function (b) { b.addEventListener('click', function () { set(b.dataset.t); }); });
    try { var s = localStorage.getItem('mpm-mock-b-theme'); if (s) set(s); } catch (e) {}
    // ?only=<flow id> shows one flow on its own (for sharing one flow, or screenshots); ?theme=dark picks the theme.
    var q = new URLSearchParams(location.search), only = q.get('only');
    if (q.get('theme')) set(q.get('theme'));
    if (only && document.getElementById(only)) {
      document.querySelectorAll('.intro, .flow, .decisions').forEach(function (el) { if (el.id !== only) el.style.display = 'none'; });
    }
  })();
</script>
</body>
</html>
`;

writeFileSync(OUT, html);
console.log(`wrote ${OUT} (${(html.length / 1024).toFixed(0)} KB, ${flows.length} flows)`);
