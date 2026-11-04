/* Dispositifs médicaux : moteur de simulation (sans dépendance).
   1. Pousse-seringue : chaîne mécanique (moteur pas à pas ou à courant continu asservi, réducteur, vis-écrou),
      hydraulique (Poiseuille, compliance de la seringue et de la ligne), alarmes (occlusion, fin de seringue),
      pharmacocinétique à un compartiment.
   2. Pompe à insuline : patient diabétique de type 1 virtuel (modèle minimal de Bergman, absorption sous-cutanée
      de l'insuline et digestive du glucose), capteur de glucose, modes manuel, boucle fermée et hybride.
   3. Hémomixeur : don de sang, poche pesée sur un plateau basculant, estimation du volume malgré l'agitation,
      fermeture de la pince, alarmes.
   Outil pédagogique : modèles simplifiés, valeurs plausibles. Ne sert en aucun cas à doser un médicament.
   Utilisable dans le navigateur (window.Dispositifs) et avec Node (module.exports). */
(function (root, factory) {
  const M = factory();
  if (typeof module === 'object' && module.exports) module.exports = M;
  else root.Dispositifs = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MMHG = 133.322; // Pa
  const G = 9.81;

  // =====================================================================
  // 1. POUSSE-SERINGUE
  // =====================================================================
  // seringues : diamètre intérieur (mm), course utile (mm), compliance de la seringue et du piston (mL/mmHg)
  const SYRINGES = {
    5: { d: 12.0, stroke: 44, C: 3e-4 },
    10: { d: 14.5, stroke: 60, C: 5e-4 },
    20: { d: 19.1, stroke: 70, C: 9e-4 },
    50: { d: 26.6, stroke: 90, C: 1.8e-3 },
  };
  // cathéters et aiguilles : diamètre intérieur (mm) et longueur (mm) ; tubulure de rallonge ajoutée à part
  const NEEDLES = { G18: { d: 0.84, L: 32 }, G20: { d: 0.60, L: 32 }, G22: { d: 0.41, L: 25 }, G24: { d: 0.31, L: 19 } };
  const areaOf = (dmm) => (Math.PI * (dmm / 1000) ** 2) / 4; // m²
  // résistance hydraulique de Poiseuille d'un tube : R = 8 μ L / (π r⁴), en Pa·s/m³
  const poiseuille = (mu, Lm, dm) => (8 * mu * Lm) / (Math.PI * (dm / 2) ** 4);

  // grandeurs de la chaîne pour un débit Q (mL/h)
  // p : { syringe, needle, tubeL (m), tubeD (mm), pitch (mm/tour), ratio (réducteur), steps (pas/tour), micro, mu (Pa·s), friction (N), Pv (mmHg) }
  function chain(p, Q) {
    const s = SYRINGES[p.syringe], A = areaOf(s.d), q = (Q * 1e-6) / 3600; // m³/s
    const v = q / A; // m/s
    const screwRps = v / (p.pitch / 1000), motorRpm = screwRps * p.ratio * 60;
    const stepsPerRev = p.steps * (p.micro || 1), stepFreq = screwRps * p.ratio * stepsPerRev;
    const volPerStep = (A * (p.pitch / 1000)) / (p.ratio * stepsPerRev) * 1e9; // µL
    const n = NEEDLES[p.needle];
    const R = poiseuille(p.mu, n.L / 1000, n.d / 1000) + poiseuille(p.mu, p.tubeL, p.tubeD / 1000);
    const dP = R * q; // Pa
    const force = (dP + p.Pv * MMHG) * A + p.friction;
    const duration = (A * (s.stroke / 1000)) / q; // s pour vider la seringue
    return { A, v, motorRpm, stepFreq, volPerStep, R, dPmmHg: dP / MMHG, force, duration, volume: (A * s.stroke) / 1e-6 * 1e-3 };
  }

  // Simulation temporelle (pas de 0,5 s par défaut)
  // scénario : { Q (mL/h), bolus: [{t (s), V (mL), Q (mL/h)}], tEnd (s), occlusion: {t, dur}, slack (mL de jeu au démarrage),
  //   alarmP (mmHg), antiBolus (bool), drive: 'stepper' | 'dc', drug: { c (mg/mL), Vd (L), half (min) }, filled (mL) }
  function simulateSyringe(p, sc) {
    const s = SYRINGES[p.syringe], A = areaOf(s.d), n = NEEDLES[p.needle];
    const R = poiseuille(p.mu, n.L / 1000, n.d / 1000) + poiseuille(p.mu, p.tubeL, p.tubeD / 1000);
    const C = (s.C * 1e-6) / MMHG; // m³/Pa
    const dt = sc.dt || 0.5, N = Math.round(sc.tEnd / dt);
    const filled = (sc.filled || 50) * 1e-6;
    let P = 0; // pression dans la seringue au-dessus de la pression veineuse (Pa)
    let pushed = 0, delivered = 0, slack = (sc.slack || 0) * 1e-6, running = true, C_blood = 0;
    let stepAcc = 0; // pas de moteur accumulés (pas à pas : volume poussé par paquets)
    const vStep = chain(p, 1).volPerStep * 1e-9;
    // moteur à courant continu asservi en vitesse (PI) : petit retard du premier ordre sur la vitesse du piston
    let vPist = 0;
    const tauM = 0.05;
    const out = { t: [], Qout: [], P: [], vol: [], C: [], alarms: [] };
    const k = Math.LN2 / ((sc.drug ? sc.drug.half : 60) * 60);
    let occluded = false, alarmed = false, endWarned = false;
    const qAt = (t) => {
      let q = sc.Q;
      for (const b of sc.bolus || []) { const dur = (b.V / b.Q) * 3600; if (t >= b.t && t < b.t + dur) q = b.Q; }
      return (q * 1e-6) / 3600;
    };
    for (let i = 0; i <= N; i++) {
      const t = i * dt;
      occluded = !!(sc.occlusion && t >= sc.occlusion.t && t < sc.occlusion.t + sc.occlusion.dur);
      let qCmd = running ? qAt(t) : 0;
      if (pushed >= filled) { qCmd = 0; running = false; }
      // mouvement du piston
      let dV = 0;
      if (sc.drive === 'dc') {
        // moteur à courant continu asservi en vitesse par codeur : vitesse du piston continue (réponse du 1er ordre)
        vPist += (qCmd / A - vPist) * (1 - Math.exp(-dt / tauM));
        dV = Math.max(0, vPist) * A * dt;
      } else {
        stepAcc += (qCmd * dt) / vStep;
        const nSteps = Math.floor(stepAcc); stepAcc -= nSteps;
        dV = nSteps * vStep;
      }
      // jeu mécanique : les premiers déplacements rattrapent le jeu sans pousser le liquide
      if (slack > 0) { const u = Math.min(slack, dV); slack -= u; dV -= u; }
      pushed += dV;
      // ligne : la pression monte avec le volume poussé, le débit sort par la résistance
      const Rline = occluded ? Infinity : R;
      // intégration exacte sur le pas : P' = (q_in − P/R)/C
      const qIn = dV / dt;
      const Pold = P;
      if (Rline === Infinity) P += (qIn * dt) / C;
      else { const tau = R * C, Pinf = qIn * R; P = Pinf + (P - Pinf) * Math.exp(-dt / tau); }
      // volume sorti pendant le pas (bilan exact) : poussé − variation du volume stocké
      let qOut = Rline === Infinity ? 0 : Math.max(0, qIn - (C * (P - Pold)) / dt);
      // anti-bolus : à l'alarme d'occlusion, le moteur s'arrête et recule pour relâcher la pression
      if (!alarmed && P / MMHG > sc.alarmP) {
        alarmed = true; running = false;
        out.alarms.push({ type: 'occlusion', t, P: P / MMHG });
        if (sc.antiBolus) { const back = P * C; pushed -= back; P = 0; out.alarms.push({ type: 'antibolus', t, V: back * 1e6 }); }
      }
      delivered += qOut * dt;
      // fin de seringue : alarme 5 minutes avant d'être vide
      const remaining = filled - pushed, qNow = qAt(t);
      if (!endWarned && running && qNow > 0 && remaining / qNow < 300) { endWarned = true; out.alarms.push({ type: 'end', t, V: remaining * 1e6 }); }
      // patient : concentration dans le sang (mg/L)
      if (sc.drug) {
        const rate = qOut * 1e6 * sc.drug.c; // mg/s
        C_blood += (rate / sc.drug.Vd - k * C_blood) * dt;
      }
      if (i % Math.max(1, Math.round((sc.sample || 10) / dt)) === 0) {
        out.t.push(t); out.Qout.push(qOut * 1e6 * 3600); out.P.push(P / MMHG); out.vol.push(delivered * 1e6); out.C.push(C_blood);
      }
    }
    out.delivered = delivered * 1e6; out.pushed = pushed * 1e6; out.tau = R * C;
    return out;
  }
  // délai théorique avant l'alarme d'occlusion : t = C·P_alarme / Q
  const occlusionDelay = (syringe, alarmP, Q) => (SYRINGES[syringe].C * alarmP) / (Q / 3600);
  // bolus libéré si l'on débouche sans anti-bolus : V = C·P
  const occlusionBolus = (syringe, P) => SYRINGES[syringe].C * P;

  // =====================================================================
  // 2. POMPE À INSULINE (patient de type 1 virtuel)
  // =====================================================================
  // temps en minutes ; G en mg/dL ; insuline en mU ; repas en g de glucides
  const PATIENT = {
    weight: 70, VG: 1.6 * 70, VI: 0.12 * 70, ke: 0.138, tmaxI: 55, tmaxG: 40, Ag: 0.8,
    p2: 0.025, p3: 8.2e-6, b: 0.56, // b : apport net de glucose par le foie, moins l'utilisation indépendante de l'insuline (mg/dL/min)
    basal: 1.0, // U/h qui maintient G vers 120 mg/dL
    carbRatio: 10, // g de glucides couverts par 1 U
    isf: 45, // baisse de glycémie pour 1 U (mg/dL)
  };
  function simulateInsulin(opt) {
    const P = Object.assign({}, PATIENT, opt.patient || {});
    const dt = 1, days = opt.days || 1, N = Math.round(days * 1440 / dt);
    const meals = opt.meals || [{ t: 7 * 60, g: 50 }, { t: 12 * 60, g: 70 }, { t: 19.5 * 60, g: 80 }];
    // état initial : régime établi avec la basale
    const u0 = (P.basal * 1000) / 60;
    let S1 = u0 * P.tmaxI, S2 = u0 * P.tmaxI, I = u0 / (P.VI * P.ke), X = (P.p3 * I) / P.p2, Gl = P.b / X;
    if (opt.G0) Gl = opt.G0;
    let D1 = 0, D2 = 0;
    let Gs = Gl, seed = opt.seed || 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const out = { t: [], G: [], Gs: [], u: [], meals, bolus: [] };
    let cgm = Gl, cgmPrev = Gl, integ = 0, uNow = u0, totalU = 0, iob = 0, lastIdx = -1;
    const iobDecay = Math.exp(-5 / 90); // insuline active : décroissance sur environ 4 h
    let carry = 0, pending = 0; // reste des impulsions, bolus en cours de délivrance (mU)
    for (let i = 0; i <= N; i++) {
      const t = i * dt, tod = t % 1440;
      // repas
      for (const m of meals) {
        const tm = m.t + Math.floor(t / 1440) * 1440;
        if (Math.abs(t - tm) < dt / 2) {
          D1 += m.g * 1000 * P.Ag;
          const announced = opt.mode === 'manual' || (opt.mode === 'hybrid' && !m.unannounced);
          if (announced && !m.noBolus) {
            const late = m.late || 0;
            const U = m.g / P.carbRatio + (opt.mode === 'hybrid' ? 0 : 0);
            out.bolus.push({ t: t + late, U });
          }
        }
      }
      // bolus programmés (en retard éventuellement)
      for (const b of out.bolus) if (!b.done && t >= b.t) { pending += b.U * 1000; b.done = true; }
      // capteur continu (toutes les 5 min, retard de 10 min, bruit)
      Gs += ((Gl - Gs) * dt) / 10;
      if (i % 5 === 0) {
        cgmPrev = cgm; cgm = Gs + (opt.noise === undefined ? 4 : opt.noise) * gauss();
        // décision de la pompe toutes les 5 minutes
        let uRate = (P.basal * 1000) / 60; // mU/min
        if (opt.mode === 'closed' || opt.mode === 'hybrid') {
          const target = opt.target || 120, e = cgm - target, dG = (cgm - cgmPrev) / 5;
          integ = Math.max(-200, Math.min(400, integ + e * 5));
          const Kp = opt.Kp === undefined ? 0.045 : opt.Kp, Ki = opt.Ki === undefined ? 0.00005 : opt.Ki, Kd = opt.Kd === undefined ? 1.5 : opt.Kd; // U/h par (mg/dL), …
          let extra = Kp * e + Ki * integ + Kd * dG; // U/h
          // limite d'insuline active : on freine la correction si beaucoup d'insuline agit déjà
          if (iob > (opt.iobMax || 3500)) extra = Math.min(extra, 0);
          let rateUh = P.basal + extra;
          // suspension prédictive : arrêt si la glycémie prévue dans 30 min passe sous 80 mg/dL
          if (cgm < 80 || cgm + 30 * dG < 80) rateUh = 0;
          rateUh = Math.max(0, Math.min(opt.maxRate || 8, rateUh));
          uRate = (rateUh * 1000) / 60;
        }
        // résolution de la pompe : 0,05 U par impulsion
        const per5 = uRate * 5 + pending + carry; pending = 0;
        const pulses = Math.floor(per5 / 50 + 1e-9) * 50; carry = per5 - pulses; // le reste est reporté à la décision suivante
        uNow = pulses / 5; totalU += pulses / 1000;
        // insuline active ajoutée au-delà de la basale (bolus et corrections)
        iob = Math.max(0, iob * iobDecay + pulses - (P.basal * 1000 * 5) / 60);
        lastIdx = i;
      }
      // absorption sous-cutanée et action de l'insuline
      S1 += (uNow - S1 / P.tmaxI) * dt;
      S2 += ((S1 - S2) / P.tmaxI) * dt;
      I += (S2 / (P.tmaxI * P.VI) - P.ke * I) * dt;
      X += (-P.p2 * X + P.p3 * I * (opt.sensitivity || 1)) * dt;
      // digestion du repas
      const Ra = D2 / P.tmaxG; // mg/min
      D1 += (-D1 / P.tmaxG) * dt; D2 += (D1 / P.tmaxG - D2 / P.tmaxG) * dt;
      // contre-régulation simple quand la glycémie est basse (le foie libère du glucose)
      const counter = Gl < 70 ? 0.02 * (70 - Gl) : 0;
      Gl += (-X * Gl + P.b + Ra / P.VG + counter) * dt;
      Gl = Math.max(20, Gl);
      if (i % 5 === 0) { out.t.push(t); out.G.push(Gl); out.Gs.push(cgm); out.u.push((uNow * 60) / 1000); }
    }
    // indicateurs
    const g = out.G, n = g.length;
    const frac = (f) => (100 * g.filter(f).length) / n;
    out.metrics = {
      tir: frac((v) => v >= 70 && v <= 180), low: frac((v) => v < 70), veryLow: frac((v) => v < 54), high: frac((v) => v > 180), veryHigh: frac((v) => v > 250),
      mean: g.reduce((a, b) => a + b, 0) / n, min: Math.min(...g), max: Math.max(...g), totalU: totalU / days,
    };
    return out;
  }

  // =====================================================================
  // 3. HÉMOMIXEUR (don de sang)
  // =====================================================================
  // p : { Pv (mmHg, garrot), h (m, poche sous le bras), needle 'G16', tubeL, tubeD (mm), mu (Pa·s, sang), target (mL),
  //       amp (°, basculement), freq (Hz), arm (m, distance du centre de la poche à l'axe), method: 'raw'|'avg'|'angle'|'level', clampDelay (s), noise (g) }
  const BLOOD = 1.053; // g/mL
  const BAG = { tare: 32, anticoag: 63, acDensity: 1.015 };
  function donorFlow(p, Vml) {
    // le débit baisse un peu au cours du don (la veine se vide, la poche se tend)
    // aiguille 16 G (1,19 mm × 38 mm), tubulure, et résistance de la veine sous le garrot
    const R = poiseuille(p.mu, 0.038, 1.19e-3) + poiseuille(p.mu, p.tubeL, p.tubeD / 1000) + (p.Rvein === undefined ? 6e9 : p.Rvein);
    const dP = p.Pv * MMHG + 1060 * G * p.h - 40 * MMHG * (Vml / 500) * (p.fatigue || 0.3);
    return Math.max(0, dP / R) * 1e6 * 60; // mL/min
  }
  function simulateDonation(p) {
    const dt = 0.01, tMax = (p.tMax || 1200);
    let V = 0, t = 0, clampAt = null, closed = false, stopReason = null;
    const out = { t: [], raw: [], est: [], truth: [], theta: [], Q: [], alarms: [] };
    const mass = () => BAG.tare + BAG.anticoag * BAG.acDensity + V * BLOOD;
    const w = 2 * Math.PI * p.freq, A = (p.amp * Math.PI) / 180;
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    // moyenne glissante sur une période de basculement
    const win = Math.max(1, Math.round(1 / p.freq / dt)), buf = []; let sum = 0;
    let est = 0, lowSince = null, lastLevel = null;
    const targetMass = BAG.tare + BAG.anticoag * BAG.acDensity + p.target * BLOOD;
    for (let i = 0; t < tMax; i++, t += dt) {
      const Q = closed ? 0 : donorFlow(p, V);
      V += (Q / 60) * dt;
      // plateau basculant : θ(t) = A·sin(ωt) ; la cellule de pesée mesure la force normale au plateau
      const th = A * Math.sin(w * t), thd = A * w * Math.cos(w * t);
      const Fn = mass() / 1000 * (G * Math.cos(th) + p.arm * thd * thd); // N
      const rawG = (Fn / G) * 1000 + (p.noise || 0.5) * gauss(); // g
      // estimation de la masse
      buf.push(rawG); sum += rawG; if (buf.length > win) sum -= buf.shift();
      if (p.method === 'raw') est = rawG;
      else if (p.method === 'avg') est = sum / buf.length;
      else if (p.method === 'angle') {
        // correction par l'angle (codeur sur l'axe) : on divise par cos θ et on retire le terme centripète
        const corr = (G * Math.cos(th) + p.arm * thd * thd) / G;
        est = 0.98 * (est || rawG) + 0.02 * (rawG / corr);
      } else if (p.method === 'level') {
        // pesée uniquement au passage à l'horizontale (θ ≈ 0), en tenant compte du terme centripète
        if (Math.abs(th) < A * 0.05) { const corr = (G + p.arm * thd * thd) / G; lastLevel = rawG / corr; }
        if (lastLevel !== null) est = lastLevel;
      }
      // arrêt : la pince se ferme quand le volume estimé atteint la cible (avec le temps de réaction de la pince)
      if (clampAt === null && est >= targetMass && t > 5) { clampAt = t + (p.clampDelay || 0.3); stopReason = 'target'; }
      if (clampAt !== null && !closed && t >= clampAt) closed = true;
      // alarmes : débit faible, don trop long
      if (!closed && Q < 20) { if (lowSince === null) lowSince = t; else if (t - lowSince > 30 && !out.alarms.some((a) => a.type === 'lowflow')) out.alarms.push({ type: 'lowflow', t }); } else lowSince = null;
      if (!closed && t > 15 * 60 && !out.alarms.some((a) => a.type === 'long')) out.alarms.push({ type: 'long', t });
      if (i % 10 === 0) { out.t.push(t); out.raw.push(rawG); out.est.push(est); out.truth.push(mass()); out.theta.push((th * 180) / Math.PI); out.Q.push(Q); }
      if (closed && t > clampAt + 3) break;
    }
    out.V = V; out.duration = clampAt; out.stopReason = stopReason;
    out.ratio = (100 * BAG.anticoag) / (BAG.anticoag + V); // part d'anticoagulant dans la poche
    out.targetMass = targetMass;
    return out;
  }
  // biais de la moyenne simple : la moyenne de cos(A sin ωt) vaut J0(A) (fonction de Bessel)
  function besselJ0(x) { let s = 0; for (let k = 0; k < 30; k++) { let f = 1; for (let j = 1; j <= k; j++) f *= j; s += ((k % 2 ? -1 : 1) * Math.pow(x / 2, 2 * k)) / (f * f); } return s; }

  return { MMHG, SYRINGES, NEEDLES, areaOf, poiseuille, chain, simulateSyringe, occlusionDelay, occlusionBolus, PATIENT, simulateInsulin, BLOOD, BAG, donorFlow, simulateDonation, besselJ0 };
});
