// Tests du moteur : node tests/test.js
const D = require('../dispositifs.js');
let ok = 0, ko = 0;
function check(name, cond, info) { if (cond) ok++; else { ko++; console.log('ÉCHEC :', name, info === undefined ? '' : info); } }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const rel = (a, b, r) => Math.abs(a - b) <= r * Math.abs(b);

// ---------- 1. Chaîne mécanique ----------
const base = { syringe: 50, needle: 'G22', tubeL: 1.5, tubeD: 1.0, pitch: 1, ratio: 10, steps: 200, micro: 16, mu: 1e-3, friction: 8, Pv: 8 };
for (const sy of [5, 10, 20, 50]) for (const Q of [0.1, 1, 2, 10, 50, 200]) {
  const p = Object.assign({}, base, { syringe: sy }), c = D.chain(p, Q);
  const A = Math.PI * (D.SYRINGES[sy].d / 2000) ** 2;
  check('S = πd²/4 (' + sy + ')', rel(c.A, A, 1e-12));
  check('Q = S·v (' + sy + ', ' + Q + ')', rel(c.v * c.A * 3600 * 1e6, Q, 1e-9));
  check('moteur = vis × réducteur', rel(c.motorRpm, (c.v * 1000 / p.pitch) * p.ratio * 60, 1e-9));
  check('fréquence des pas', rel(c.stepFreq, (c.motorRpm / 60) * p.steps * p.micro, 1e-9));
  check('volume par pas × fréquence = Q', rel(c.volPerStep * 1e-9 * c.stepFreq * 3600 * 1e6, Q, 1e-9));
  check('autonomie = volume / Q', rel(c.duration, (A * D.SYRINGES[sy].stroke / 1000) / (Q * 1e-6 / 3600), 1e-9));
  check('ΔP = R·Q', rel(c.dPmmHg * D.MMHG, c.R * Q * 1e-6 / 3600, 1e-9));
  check('effort ≥ frottement', c.force > p.friction);
}
// Poiseuille : r⁴ ; doubler le diamètre divise R par 16, doubler la longueur double R
check('Poiseuille ∝ L', rel(D.poiseuille(1e-3, 2, 1e-3), 2 * D.poiseuille(1e-3, 1, 1e-3), 1e-12));
check('Poiseuille ∝ 1/d⁴', rel(D.poiseuille(1e-3, 1, 2e-3), D.poiseuille(1e-3, 1, 1e-3) / 16, 1e-12));
check('Poiseuille valeur', rel(D.poiseuille(1e-3, 1, 1e-3), 8e-3 / (Math.PI * 0.0005 ** 4), 1e-12));
// une aiguille plus fine augmente la pression
check('24 G > 18 G en pression', D.chain(Object.assign({}, base, { needle: 'G24' }), 10).dPmmHg > D.chain(Object.assign({}, base, { needle: 'G18' }), 10).dPmmHg);
// plus de micro-pas → volume par pas plus petit
check('micro-pas', rel(D.chain(Object.assign({}, base, { micro: 32 }), 2).volPerStep * 2, D.chain(Object.assign({}, base, { micro: 16 }), 2).volPerStep, 1e-12));

// ---------- 2. Simulation du pousse-seringue ----------
const sim = (sc, p) => D.simulateSyringe(Object.assign({}, base, p || {}), Object.assign({ Q: 2, tEnd: 7200, slack: 0, alarmP: 500, antiBolus: true, drive: 'stepper', filled: 50, sample: 10 }, sc));
// régime établi : le débit reçu rejoint le débit prescrit, volume ≈ Q·t
for (const Q of [1, 2, 5, 20]) {
  const r = sim({ Q, tEnd: 3600 });
  check('volume reçu ≈ Q·t (' + Q + ')', rel(r.delivered, Q, 0.03), r.delivered);
  check('aucune alarme sans occlusion (' + Q + ')', !r.alarms.some((a) => a.type === 'occlusion'));
}
// jeu au démarrage : retard = jeu / Q
{
  const r = sim({ Q: 2, tEnd: 3600, slack: 0.1 });
  const i = r.Qout.findIndex((q) => q > 1);
  check('retard du jeu = jeu/Q', near(r.t[i] / 60, 3, 0.8), r.t[i] / 60);
}
// occlusion : alarme après C·P/Q
for (const [sy, Q] of [[50, 2], [50, 10], [20, 1], [10, 5], [5, 20]]) {
  const r = sim({ Q, tEnd: 4 * 3600, occlusion: { t: 600, dur: 6 * 3600 }, filled: sy }, { syringe: sy });
  const a = r.alarms.find((x) => x.type === 'occlusion');
  const th = D.occlusionDelay(sy, 500, Q);
  check('alarme présente (' + sy + ' mL, ' + Q + ' mL/h)', !!a);
  if (a) check('délai C·P/Q (' + sy + ', ' + Q + ')', rel(a.t - 600, th, 0.08), [(a.t - 600) / 60, th / 60]);
  const b = r.alarms.find((x) => x.type === 'antibolus');
  check('anti-bolus = C·P (' + sy + ')', b && rel(b.V, D.occlusionBolus(sy, 500), 0.08), b && b.V);
}
check('27 min à 2 mL/h, seringue 50 mL', near(D.occlusionDelay(50, 500, 2) / 60, 27, 0.01));
// sans anti-bolus, le volume stocké part dans le patient au débouchage
{
  const occl = { t: 600, dur: 2400 };
  const a = sim({ Q: 2, tEnd: 5400, occlusion: occl, antiBolus: false });
  const b = sim({ Q: 2, tEnd: 5400, occlusion: occl, antiBolus: true });
  // le pic dure environ R·C ≈ 1 s : on compare les volumes reçus
  check('sans anti-bolus : C·P de plus dans le patient', near(a.delivered - b.delivered, D.occlusionBolus(50, 500), 0.1), a.delivered - b.delivered);
  const fine = sim({ Q: 2, tEnd: 3200, occlusion: occl, antiBolus: false, sample: 0.5 });
  check('pic de débit au débouchage', Math.max(...fine.Qout) > 100, Math.max(...fine.Qout));
}
// courant continu asservi : même débit moyen
{
  const r = sim({ Q: 5, tEnd: 3600, drive: 'dc' });
  check('moteur CC : volume', rel(r.delivered, 5, 0.03), r.delivered);
}
// pharmacocinétique : C∞ = débit·c / (Vd·k)
{
  const dr = { c: 0.5, Vd: 20, half: 2 };
  const r = sim({ Q: 2, tEnd: 3600, drug: dr });
  const k = Math.LN2 / (dr.half * 60), Css = (2 / 3600) * dr.c / dr.Vd / k;
  check('concentration d’équilibre', rel(r.C[r.C.length - 1], Css, 0.03), [r.C[r.C.length - 1], Css]);
}
// alarme de fin de seringue
{
  const r = sim({ Q: 50, tEnd: 3600, filled: 10 });
  const a = r.alarms.find((x) => x.type === 'end');
  check('alarme fin de seringue', a && near(a.t, 10 / 50 * 3600 - 300, 30), a && a.t);
}

// ---------- 3. Pompe à insuline ----------
const SC = {
  normal: { meals: [{ t: 420, g: 50 }, { t: 720, g: 70 }, { t: 1170, g: 80 }] },
  forgot: { meals: [{ t: 420, g: 50 }, { t: 720, g: 70, noBolus: true }, { t: 1170, g: 80 }] },
  snack: { meals: [{ t: 420, g: 50 }, { t: 720, g: 70 }, { t: 960, g: 30, unannounced: true, noBolus: true }, { t: 1170, g: 80 }] },
  sick: { meals: [{ t: 420, g: 50 }, { t: 720, g: 70 }, { t: 1170, g: 80 }], sensitivity: 0.7 },
};
const runI = (sc, mode) => D.simulateInsulin(Object.assign({ mode }, SC[sc])).metrics;
// basale seule, sans repas : glycémie stable vers 120
{
  const m = D.simulateInsulin({ mode: 'basal', meals: [], noise: 0 }).metrics;
  check('équilibre basal', near(m.mean, 120, 10) && m.max - m.min < 15, m);
}
for (const sc of Object.keys(SC)) for (const mode of ['manual', 'hybrid', 'closed']) {
  const m = runI(sc, mode);
  check('pas d’hypo sévère (' + sc + ', ' + mode + ')', m.veryLow === 0, m.min);
  check('indicateurs cohérents (' + sc + ', ' + mode + ')', near(m.tir + m.low + m.high, 100, 1e-6) && m.min <= m.mean && m.mean <= m.max);
}
check('journée normale manuelle : pas d’hypo', runI('normal', 'manual').low === 0);
for (const sc of ['forgot', 'snack', 'sick']) check('hybride ≥ manuel (' + sc + ')', runI(sc, 'hybrid').tir > runI(sc, 'manual').tir, [runI(sc, 'hybrid').tir, runI(sc, 'manual').tir]);
check('boucle fermée seule < hybride (normal)', runI('normal', 'closed').tir <= runI('normal', 'hybrid').tir + 1);
check('basale seule : hyperglycémie', D.simulateInsulin({ mode: 'basal', ...SC.normal }).metrics.high > 40);
// résolution de 0,05 U
{
  const r = D.simulateInsulin({ mode: 'hybrid', ...SC.normal });
  check('impulsions de 0,05 U', r.u.every((u) => near(Math.round(u / 0.6) * 0.6, u, 1e-9)));
  check('débit borné', r.u.every((u) => u >= 0));
}
// moins de sensibilité → plus d'insuline et glycémie plus haute
check('résistance : plus d’insuline', D.simulateInsulin({ mode: 'hybrid', ...SC.sick }).metrics.totalU > D.simulateInsulin({ mode: 'hybrid', ...SC.normal }).metrics.totalU);

// ---------- 4. Hémomixeur ----------
const donor = { Pv: 50, h: 0.5, tubeL: 1.2, tubeD: 3.0, mu: 3.5e-3, target: 450, amp: 15, freq: 0.5, arm: 0.06, clampDelay: 0.3, noise: 0.5 };
check('J0(0) = 1', near(D.besselJ0(0), 1, 1e-15));
check('J0(2,4048) ≈ 0', near(D.besselJ0(2.404825557695773), 0, 1e-9));
check('J0(1) tabulé', near(D.besselJ0(1), 0.7651976865579666, 1e-12));
{
  const q0 = D.donorFlow(donor, 0), q1 = D.donorFlow(donor, 450);
  check('débit initial plausible (40–90 mL/min)', q0 > 40 && q0 < 90, q0);
  check('le débit baisse pendant le don', q1 < q0);
  check('poche plus basse = débit plus fort', D.donorFlow(Object.assign({}, donor, { h: 0.8 }), 0) > q0);
}
const res = {};
for (const method of ['raw', 'avg', 'angle', 'level']) {
  const r = D.simulateDonation(Object.assign({}, donor, { method }));
  res[method] = r;
  check('pince fermée (' + method + ')', r.stopReason === 'target');
  check('durée 5–12 min (' + method + ')', r.duration / 60 > 5 && r.duration / 60 < 12, r.duration / 60);
  check('pas d’alarme (' + method + ')', r.alarms.length === 0, r.alarms);
}
check('angle : ±3 mL', near(res.angle.V, 450, 3), res.angle.V);
check('horizontale : ±3 mL', near(res.level.V, 450, 3), res.level.V);
check('moyenne : biais positif (J0 < 1)', res.avg.V > 452, res.avg.V);
// biais de la moyenne ≈ masse × (1/J0 − 1) / densité
{
  const A = (donor.amp * Math.PI) / 180, M = res.avg.targetMass;
  const bias = (M * (1 / D.besselJ0(A) - 1)) / D.BLOOD;
  check('biais de la moyenne ≈ théorie J0', near(res.avg.V - 450, bias, 4), [res.avg.V - 450, bias]);
}
check('meilleure méthode que la moyenne', Math.abs(res.angle.V - 450) < Math.abs(res.avg.V - 450));
check('part d’anticoagulant 63/(63+V)', rel(res.angle.ratio, 100 * 63 / (63 + res.angle.V), 1e-12));
// sans agitation, toutes les méthodes se valent
{
  const v = ['raw', 'avg', 'angle', 'level'].map((m) => D.simulateDonation(Object.assign({}, donor, { amp: 0.001, method: m })).V);
  check('sans agitation : méthodes équivalentes', Math.max(...v) - Math.min(...v) < 3, v);
}
// veine faible : alarme de débit faible
{
  const r = D.simulateDonation(Object.assign({}, donor, { Pv: 5, h: 0.05, method: 'angle', Rvein: 4e10, tMax: 1200 }));
  check('alarme de débit faible ou de don trop long', r.alarms.length > 0, r.alarms);
}

// ---------- 5. Hémomixeur complet : bielle, chaîne de pesée, automate ----------
{
  const g = D.CRANK;
  // fermeture géométrique |AB| = L vérifiée sur un tour
  let th = 0, worst = 0;
  for (let i = 0; i <= 360; i++) {
    const phi = (i / 360) * 2 * Math.PI; th = D.crankTheta(g, phi, th);
    const ax = g.b * Math.cos(th) - (g.b + g.r * Math.cos(phi)), ay = g.b * Math.sin(th) - (-g.L + g.r * Math.sin(phi));
    worst = Math.max(worst, Math.abs(Math.hypot(ax, ay) - g.L));
  }
  check('bielle : |AB| = L', worst < 1e-12, worst);
  check('bielle : amplitude ≈ asin(r/b)', near(D.crankRange(g).amp, Math.asin(g.r / g.b), 0.003), D.crankRange(g).amp);
  check('bielle : mouvement non symétrique (obliquité)', Math.abs(D.crankRange(g).hi + D.crankRange(g).lo) > 1e-4);
  check('amplitude croît avec r', D.crankRange({ ...g, r: 0.012 }).amp > D.crankRange({ ...g, r: 0.006 }).amp);
  check('période : θ(φ + 2π) = θ(φ)', near(D.crankTheta(g, 1.3, 0), D.crankTheta(g, 1.3 + 2 * Math.PI, 0), 1e-12));
  // capteur : étalonnage
  for (const m of [0, 100, 250, 400, 600]) {
    check('S3 inverse la caractéristique (' + m + ' g)', near(D.invLin3(D.sensorV(m)), m, 1e-9));
  }
  check('étalonnage 2 points exact en 0 et 500 g', near(D.invLinear(D.sensorV(0)), 0, 1e-9) && near(D.invLinear(D.sensorV(500)), 500, 1e-9));
  check('étalonnage 2 points faux entre les points', Math.abs(D.invLinear(D.sensorV(250)) - 250) > 1);
  check('pente 2,65 mV/g', near((D.sensorV(1) - D.sensorV(0)) * 1000, 2.65, 0.01));
}
const auto = { Pv: 50, h: 0.5, tubeL: 1.2, tubeD: 3, mu: 3.8e-3, target: 450, clampTime: 0.6 };
const A = {};
for (const m of ['raw', 'rc', 'avg', 'angle', 'level']) A[m] = D.simulateAutomate({ ...auto, method: m });
{
  const r = A.angle;
  check('séquence E1→E2→E4→E5→E6→E7→E4', r.log.map((l) => l.to).join(',') === 'E2,E4,E5,E6,E7,E4', r.log.map((l) => l.to));
  check('fin normale sur le volume', r.final === 'E7' && r.reason === 'target');
  check('tare = poche + anticoagulant (±1 g)', near(r.tare, r.trueTare, 1), [r.tare, r.trueTare]);
  check('angle : ±3 mL', near(A.angle.V, 450, 3), A.angle.V);
  check('horizontale : ±3 mL', near(A.level.V, 450, 3), A.level.V);
  check('filtre RC : biais positif', A.rc.V > 453, A.rc.V);
  check('moyenne : biais positif', A.avg.V > 453, A.avg.V);
  check('durée 6–10 min', r.duration / 60 > 6 && r.duration / 60 < 10, r.duration / 60);
  check('pince fermée à la fin', r.clamp[r.clamp.length - 1] === 1);
  check('échantillons CAN quantifiés (12 bits)', r.S1.every((v) => near(Math.round(v / (5 / 4096)) * (5 / 4096), v, 1e-9)));
  check('S2 lisse S1', (() => { const d = (a) => a.slice(1).reduce((s, v, i) => s + Math.abs(v - a[i]), 0); return d(r.S2) < d(r.S1) / 3; })());
  // le courant du moteur d'agitation augmente avec la masse de la poche
  const i6 = r.t.map((x, i) => i).filter((i) => r.state[i] === 'E6');
  const amp = (ids) => Math.max(...ids.map((i) => r.I[i])) - Math.min(...ids.map((i) => r.I[i]));
  check('courant MA : ondulation croissante avec la masse', amp(i6.slice(-300)) > 1.5 * amp(i6.slice(20, 320)), [amp(i6.slice(20, 320)), amp(i6.slice(-300))]);
  check('courant MA nominal < seuil', Math.max(...i6.map((i) => r.I[i])) < 150);
}
check('sans linéarisation : erreur plus grande', Math.abs(D.simulateAutomate({ ...auto, method: 'level', lin: false }).V - 450) > Math.abs(A.level.V - 450));
// défauts injectés
for (const [type, fin, why] of [['sensor', 'E3', 'sensor'], ['jam', 'E3', 'jam'], ['vein', 'E3', 'lowflow'], ['stop', 'E7', 'stop']]) {
  const r = D.simulateAutomate({ ...auto, method: 'angle', fault: { type, t: 120 } });
  check('défaut ' + type + ' → ' + fin, r.final === fin && r.reason === why, [r.final, r.reason]);
  check('défaut ' + type + ' : poche incomplète', r.V < 400, r.V);
  check('défaut ' + type + ' : pince fermée', r.clamp[r.clamp.length - 1] === 1);
  if (type === 'jam') check('plateau bloqué : surintensité', Math.max(...r.I) > 150);
}
// pince plus lente : un peu plus de volume
check('pince lente → volume plus grand', D.simulateAutomate({ ...auto, method: 'angle', clampTime: 2 }).V > A.angle.V);

console.log(ok + ' réussis, ' + ko + ' échoués');
process.exit(ko ? 1 : 0);
