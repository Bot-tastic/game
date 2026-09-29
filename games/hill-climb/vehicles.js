// vehicles.js — the five cars in the garage.
//
// A vehicle is pure data: its body (size, mass, suspension anchors, where the
// driver's head sits), its drivetrain (torque, top-speed fade, how much of it
// reaches the front wheel), and a look the renderer paints from. The physics
// reads every field through `car.spec`, so a new car is one entry here plus a
// body in render.js.
//
// Each car has its own upgrade levels (upgrades.js) and a price. The buggy is
// free; everything after it is a real step up and costs like one — the later
// worlds are balanced around owning, and upgrading, one of them.

export const VEHICLES = [
  {
    id: "buggy",
    name: "Rookie Buggy",
    icon: "🏎️",
    blurb: "Light, twitchy, rear-wheel drive. Fine for the farm, out of its depth past it.",
    price: 0,
    chassis: { w: 2.0, h: 0.62, mass: 260 },
    wheel: { r: 0.42, mass: 32 },
    anchors: [
      { x: -0.78, y: -0.1 },
      { x: 0.82, y: -0.1 },
    ],
    rest: 0.52,
    head: { x: -0.02, y: 0.72, r: 0.2 },
    power: 2400, // wheel torque, N·m, at full throttle from standstill
    fade: 38, // wheel spin (rad/s) at which torque has halved: sets top speed
    grip: 1,
    fuel: 1,
    awd: 0, // share of torque sent to the front wheel, stock
    susp: 1,
    air: 6.2, // air-control authority
    wheelie: 1, // how hard engine torque lifts the nose
    costScale: 1,
    look: { style: "buggy", accent: "#ff7a4a", body: ["#ff7a4a", "#e8402a", "#a82414"], trim: "#ffffff", hub: "#e8402a", number: "7" },
  },
  {
    id: "jeep",
    name: "Trail Jeep",
    icon: "🚙",
    blurb: "Four-wheel drive and a big tank. Slow, heavy, and it climbs anything with grip.",
    price: 15000,
    chassis: { w: 2.3, h: 0.78, mass: 330 },
    wheel: { r: 0.47, mass: 36 },
    anchors: [
      { x: -0.88, y: -0.18 },
      { x: 0.92, y: -0.18 },
    ],
    rest: 0.56,
    head: { x: -0.1, y: 0.86, r: 0.2 },
    power: 3200,
    fade: 32,
    grip: 1.04,
    fuel: 1.2,
    awd: 0.45,
    susp: 1.08,
    air: 5.2,
    wheelie: 0.8,
    costScale: 2.2,
    look: { style: "jeep", accent: "#8bc46a", body: ["#8bc46a", "#4f8a3a", "#2c5420"], trim: "#1d2a18", hub: "#f2c230", number: "" },
  },
  {
    id: "rally",
    name: "Rally Coupe",
    icon: "🚗",
    blurb: "Sticky tyres, a screaming engine and a top speed the others can only dream of.",
    price: 35000,
    chassis: { w: 2.25, h: 0.58, mass: 280 },
    wheel: { r: 0.44, mass: 30 },
    anchors: [
      { x: -0.86, y: -0.12 },
      { x: 0.9, y: -0.12 },
    ],
    rest: 0.5,
    head: { x: -0.1, y: 0.66, r: 0.2 },
    power: 3300,
    fade: 58,
    grip: 1.22,
    fuel: 1.4,
    awd: 0.42,
    susp: 1.05,
    air: 6.6,
    wheelie: 0.75,
    costScale: 4,
    look: { style: "rally", accent: "#5ec8ff", body: ["#5ec8ff", "#1e7ad8", "#0c3e86"], trim: "#ffd166", hub: "#ffd166", number: "21" },
  },
  {
    id: "monster",
    name: "Monster Truck",
    icon: "🛻",
    blurb: "Huge wheels, huge travel, huge torque. Rolls over things the others fall into.",
    price: 70000,
    chassis: { w: 2.5, h: 0.8, mass: 420 },
    wheel: { r: 0.72, mass: 55 },
    anchors: [
      { x: -1.0, y: -0.35 },
      { x: 1.05, y: -0.35 },
    ],
    rest: 0.62,
    head: { x: -0.05, y: 0.9, r: 0.2 },
    power: 6600,
    fade: 24,
    grip: 1.2,
    fuel: 1.7,
    awd: 0.55,
    susp: 1.3,
    air: 5.6,
    wheelie: 0.8,
    costScale: 7,
    look: { style: "monster", accent: "#c77dff", body: ["#c77dff", "#8a2be2", "#4a1080"], trim: "#3ddc84", hub: "#3ddc84", number: "" },
  },
  {
    id: "rocket",
    name: "Hyper Rocket",
    icon: "🚀",
    blurb: "A jet-age prototype: all-wheel drive, absurd power, a fuel cell that lasts forever.",
    price: 150000,
    chassis: { w: 2.4, h: 0.56, mass: 300 },
    wheel: { r: 0.46, mass: 30 },
    anchors: [
      { x: -0.92, y: -0.12 },
      { x: 0.96, y: -0.12 },
    ],
    rest: 0.5,
    head: { x: -0.2, y: 0.64, r: 0.2 },
    power: 4300,
    fade: 70,
    grip: 1.32,
    fuel: 2.0,
    awd: 0.6,
    susp: 1.1,
    air: 8.5,
    wheelie: 0.6,
    costScale: 12,
    look: { style: "rocket", accent: "#ff5d8f", body: ["#f4f6fa", "#b8c0cc", "#5a6270"], trim: "#ff5d8f", hub: "#ff5d8f", number: "" },
  },
];

export const getVehicle = (id) => VEHICLES.find((v) => v.id === id) || VEHICLES[0];
