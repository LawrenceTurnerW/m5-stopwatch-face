async function later() { await null; print("after await"); }
function draw() { later(); Promise.resolve().then(() => print("then")); }
