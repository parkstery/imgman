const fs = require('fs');
const path = require('path');

const DEFAULT_OUT = path.join(__dirname, '../tests/fixtures/im-261026-logo.png');

function usage() {
  console.error('Usage: node scripts/extract-fixture-png.cjs <input.svg> [output.png]');
  console.error('');
  console.error('  input.svg   SVG file containing an embedded data:image/png;base64,... payload');
  console.error('  output.png  Optional output path (default: tests/fixtures/im-261026-logo.png)');
  process.exit(1);
}

const svgPath = process.argv[2];
if (!svgPath) {
  usage();
}

const outPath = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUT;

const s = fs.readFileSync(path.resolve(svgPath), 'utf8');
const m = s.match(/data:image\/png;base64,([^"]+)/);
if (!m) {
  console.error('No embedded PNG found in', svgPath);
  process.exit(1);
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.from(m[1], 'base64'));
console.log('Wrote', outPath, fs.statSync(outPath).size, 'bytes');
