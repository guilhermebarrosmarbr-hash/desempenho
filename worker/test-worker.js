export default { async fetch(request) { const res = await fetch("http://92.113.38.123:9000/api/contracts"); return new Response(await res.text()); } }
