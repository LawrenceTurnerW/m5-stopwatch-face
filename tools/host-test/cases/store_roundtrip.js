function setup() { const s = store.load(); print("loaded", JSON.stringify(s)); store.save({ n: (s ? s.n : 0) + 1, list: [1, "二", null] }); }
function draw() {}
