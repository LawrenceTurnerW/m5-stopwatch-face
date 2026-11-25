let depth = 0;
function dive() { depth++; dive(); }
function setup() { try { dive(); } catch (e) { print(e.name, depth > 20 ? "deep-enough" : "too-shallow:" + depth); } }
function draw() { dive(); }
