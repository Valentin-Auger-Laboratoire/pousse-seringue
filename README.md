# Dispositifs médicaux : pousse-seringue, pompe à insuline et hémomixeur

🇫🇷 [Français](#français) · 🇬🇧 [English](#english)

**Essayer l'outil :** https://valentin-auger-laboratoire.github.io/portfolio/outils/dispositifs-medicaux/

> Outil pédagogique : modèles simplifiés et valeurs plausibles. **Pas un dispositif médical.** Il ne sert en aucun cas à régler un appareil ni à doser un médicament.

---

## Français

### Pourquoi ce projet
En CPGE TSI, j'ai étudié en TP la chaîne d'asservissement d'un pousse-seringue et un hémomixeur (agitateur-peseur de poche de don de sang). J'ai repris ces deux appareils de zéro, sans rien reprendre des sujets de TP. J'y ai ajouté un troisième dispositif, la pompe à insuline en boucle fermée, qui pousse plus loin la même idée : une machine qui décide seule de la dose. Le simulateur suit chaque appareil de la mécanique jusqu'au patient, en JavaScript pur, sans bibliothèque.

### 1. Pousse-seringue
- **Chaîne mécanique** : moteur pas à pas (micro-pas) ou moteur à courant continu asservi, réducteur, vis-écrou et piston. L'outil calcule la vitesse du piston, la vitesse du moteur, le volume par pas, l'effort sur le piston et l'autonomie.
- **Hydraulique** : pertes de charge de Poiseuille dans le cathéter (18 à 24 G) et la tubulure. La seringue et la ligne sont élastiques (compliance C).
- **Sécurité** :
  - jeu mécanique au démarrage ;
  - alarme d'occlusion au seuil de pression ;
  - anti-bolus (le piston recule à l'alarme) ;
  - alarme de fin de seringue.
- **Patient** : concentration dans le sang (modèle à un compartiment) pour un médicament fictif à demi-vie courte ou longue.
- Animation de la chaîne et débit instantané sur 20 s, qui montre les « paquets » du moteur pas à pas.

À 2 mL/h avec une seringue de 50 mL, l'alarme d'occlusion sonne **27 minutes** après le blocage (t = C·P/Q). Au débouchage, sans anti-bolus, environ 0,9 mL partent d'un coup dans la veine.

### 2. Pompe à insuline en boucle fermée
- Patient diabétique de type 1 virtuel :
  - modèle minimal de Bergman ;
  - absorption sous-cutanée de l'insuline et digestion des glucides, à deux compartiments chacune ;
  - contre-régulation simple quand la glycémie est basse.
- Capteur de glucose : mesure toutes les 5 min, avec 10 min de retard et du bruit.
- La pompe délivre par impulsions de 0,05 U ; le reste est reporté à la décision suivante.
- **Trois modes** :
  - manuel (basale + bolus aux repas) ;
  - boucle fermée seule ;
  - boucle fermée hybride (boucle + bolus annoncés).
- **Régulateur** : PID sur la glycémie du capteur, limite d'insuline active, débit maximal, suspension prédictive si la glycémie prévue dans 30 min passe sous 80 mg/dL.
- **Scénarios** : journée normale, bolus oublié, bolus en retard, collation non annoncée, sport (sensibilité plus forte), malade (résistance à l'insuline).
- Indicateurs : temps dans la cible 70–180 mg/dL, temps sous 70, au-dessus de 180, insuline totale. Un tableau compare les trois modes sur le même scénario.

Le mode hybride fait mieux que le mode manuel quand le patient oublie un bolus ou mange sans le dire. L'après-midi de sport montre aussi l'inverse : avec la sensibilité qui augmente, la boucle provoque des hypoglycémies légères. Le simulateur le montre au lieu de le cacher.

### 3. Hémomixeur (don de sang)
Un hémomixeur pèse la poche pendant le don, la berce pour mélanger le sang avec l'anticoagulant, et pince la tubulure au bon volume. J'en ai manipulé un en TP de CPGE ; le simulateur reprend sa logique (automate, moteurs, signaux de pesée) avec mes propres modèles.

- **Automate à 7 états**, dessiné en graphe et suivi pendant l'animation, avec un journal horodaté :
  E1 hors tension → E2 initialisation (pince ouverte, test du capteur) → E4 attente → E5 préparation et tare de la poche vide → E6 prélèvement → E7 fin (pince fermée) → E4 quand la poche est retirée. Depuis E2, E5 ou E6, un défaut mène à E3 (agitation arrêtée, pince fermée).
- **Bielle d'agitation** : le moteur MA entraîne une manivelle, une bielle fait basculer le plateau. L'angle du plateau vient de la fermeture géométrique |AB| = L, résolue par la méthode de Newton. Avec une manivelle de 10 mm et une attache à 40 mm de l'axe, le plateau bascule de ±14,5°, et le mouvement n'est pas tout à fait sinusoïdal.
- **Moteur d'agitation à courant continu** : la vitesse dépend de la tension, et le courant suit le couple ramené par le réducteur (inertie et poids de la poche). L'ondulation du courant grandit quand la poche se remplit ; une surintensité signale un plateau bloqué.
- **Pince motorisée MC** avec un temps de course : plus elle est lente, plus il passe de sang après la décision.
- **Chaîne de pesée** :
  - cellule et conditionneur (S1 : 1,70 V + 2,65 mV/g, légèrement non linéaire) ;
  - filtre RC analogique de 0,8 s (S2) ;
  - conversion 12 bits à 40 Hz ;
  - linéarisation (S3, étalonnage 3 points) ou étalonnage linéaire à 2 points ;
  - tare de la poche vide.
- **Débit du don** : pression veineuse sous garrot, hauteur de la poche, aiguille 16 G et tubulure (Poiseuille), résistance de la veine. Un don de 450 mL dure environ 7,5 minutes.
- **Cinq façons d'estimer la masse**, comparées dans un tableau :

  | Méthode | Résultat (cible 450 mL) |
  |---|---|
  | Signal brut S1 | La pince se ferme sur un pic : −1,4 mL |
  | Filtre RC S2 | La moyenne de cos θ est inférieure à 1 : +7 mL |
  | Moyenne sur une oscillation | Même biais : +9 mL |
  | Correction par l'angle du codeur | +0,5 mL |
  | Pesée au passage à l'horizontale | +0,4 mL |

- **Défauts à provoquer** 2 minutes après le début :
  - capteur débranché → E3 ;
  - plateau bloqué (surintensité) → E3 ;
  - veine bouchée (débit faible pendant 60 s) → E3 ;
  - arrêt par l'opérateur → E7 avec une poche incomplète.
- Graphiques : tensions S1 et S2 sur tout le don, zoom sur les 30 dernières secondes, courants des deux moteurs, débit.

### Fichiers
| Fichier | Rôle |
|---|---|
| `dispositifs.js` | Moteur des simulations, dont l'automate de l'hémomixeur (testable avec Node) |
| `index.html` | Interface, animations et graphiques, bilingue FR / EN |
| `tests/test.js` | Tests |

### Lancer les tests
```bash
node tests/test.js
```
328 vérifications. Elles couvrent :
- **Pousse-seringue, chaîne** :
  - section πd²/4 et Q = S·v ;
  - vitesse du moteur, fréquence des pas, volume par pas ;
  - autonomie ;
  - Poiseuille (proportionnel à L et à 1/d⁴).
- **Pousse-seringue, simulation** :
  - volume reçu égal à Q·t en régime établi ;
  - retard dû au jeu égal à jeu/Q ;
  - délai d'occlusion égal à C·P/Q pour 5 couples seringue/débit ;
  - volume anti-bolus égal à C·P, et C·P de plus dans le patient sans anti-bolus ;
  - concentration d'équilibre ;
  - alarme de fin de seringue.
- **Pompe à insuline** :
  - équilibre stable à 120 mg/dL avec la basale seule ;
  - aucune hypoglycémie sévère dans aucun mode ni scénario ;
  - le mode hybride bat le mode manuel quand un bolus est oublié, quand une collation n'est pas annoncée et quand le patient est malade ;
  - impulsions de 0,05 U.
- **Hémomixeur** :
  - J₀ comparé à des valeurs tabulées ;
  - débit plausible et décroissant ;
  - bielle : fermeture |AB| = L à 10⁻¹² près sur un tour, amplitude proche de asin(r/b), mouvement périodique et non symétrique ;
  - capteur : la linéarisation inverse exactement la caractéristique, l'étalonnage 2 points est faux entre ses points ;
  - automate : séquence E1 → E2 → E4 → E5 → E6 → E7 → E4, tare juste à 1 g près, échantillons quantifiés sur 12 bits, S2 plus lisse que S1 ;
  - volume à ±3 mL avec la correction par l'angle et avec la pesée à l'horizontale ; biais positif du filtre RC et de la moyenne ;
  - courant d'agitation croissant avec la masse et sous le seuil ; surintensité si le plateau est bloqué ;
  - chacun des 4 défauts mène au bon état, avec une poche incomplète et la pince fermée.

### Limites
- Valeurs plausibles, pas celles d'un appareil précis. Les dimensions de la bielle, les constantes des moteurs et du capteur sont des choix réalistes, pas celles du banc de TP. Le patient virtuel est un modèle simple, très loin des simulateurs validés utilisés pour homologuer les vraies boucles fermées.
- Le régulateur est un PID volontairement simple. Les vraies pompes utilisent des algorithmes plus élaborés (commande prédictive, logique floue), validés cliniquement.
- **Outil pédagogique, pas un dispositif médical.**

---

## English

**Try it:** https://valentin-auger-laboratoire.github.io/portfolio/outils/dispositifs-medicaux/

> Teaching tool with simplified models and plausible values. **Not a medical device.** Never use it to set up a device or dose a drug.

### Why
In my CPGE (engineering preparatory class) lab sessions, I studied the control loop of a syringe pump and a blood donation mixer. I rebuilt both devices from scratch and added a third one, a closed-loop insulin pump. Each device is simulated from the mechanics to the patient, in plain JavaScript.

### What it does
- **Syringe pump**:
  - stepper or speed-controlled DC motor, gearbox, lead screw and plunger;
  - Poiseuille losses in the catheter and tubing, with line compliance;
  - start-up slack, occlusion alarm (t = C·P/Q: 27 min at 2 mL/h on a 50 mL syringe), anti-bolus and near-empty alarm;
  - one-compartment drug concentration.
- **Insulin pump**:
  - virtual type 1 patient (Bergman minimal model, subcutaneous insulin and meal absorption);
  - glucose sensor with lag and noise, pump delivering 0.05 U pulses;
  - manual, closed-loop and hybrid modes;
  - PID controller with insulin-on-board limit and predictive low-glucose suspend;
  - six day scenarios; time-in-range metrics.
- **Blood mixer**:
  - 7-state controller drawn as a graph and followed during the animation (power off, initialisation, waiting, tare, collection, end, fault), with a timestamped log;
  - plate rocked by a crank and connecting rod (loop closure solved by Newton's method), DC rocking motor whose current follows the reflected torque (overcurrent = jammed plate), motorised clamp;
  - weighing chain: conditioner S1, analogue RC filter S2, 12-bit ADC at 40 Hz, linearisation S3, tare;
  - injectable faults: unplugged sensor, jammed plate, blocked vein, operator stop;
  - donor flow (tourniquet, bag height, 16 G needle, vein resistance);
  - rocking plate seen by the load cell through cos θ plus a centripetal term;
  - five mass estimates compared: raw, RC filter and one-period average (+7 to +9 mL bias from the mean of cos θ), encoder-angle correction and level-crossing weighing (both under 1 mL).

### Tests
```bash
node tests/test.js
```
328 checks:
- chain formulas and Poiseuille;
- occlusion delay C·P/Q, anti-bolus volume C·P;
- steady-state concentration;
- basal equilibrium; no severe hypoglycaemia; hybrid beating manual on the hard scenarios;
- J₀ bias of the average, angle and level methods within ±3 mL;
- crank loop closure, sensor linearisation, controller state sequence, motor current, and the four faults ending in the right state.

### Limits
- Plausible values, not a specific device. The virtual patient is far simpler than the validated simulators used to approve real closed loops, and the controller is a simple PID.
- Teaching tool, not a medical device.

---

← [Portfolio](https://valentin-auger-laboratoire.github.io/portfolio/#projets)
