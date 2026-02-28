import { useState, useEffect, useRef } from “react”;

const STORAGE_KEY = “flipper-pro-v1”;
const BUDGET_KEY  = “flipper-pro-budget”;
const EBAY_KEY    = “flipper-pro-ebay”;
const SPEND_KEY   = “flipper-pro-spending”;

const CATEGORIES = {
pokemon:     { label: “Pokémon”,      icon: “⚡”, color: “#f0c040”, accent: “#ff6b35”, type: “card”, ebayCategory: “183454” },
yugioh:      { label: “Yu-Gi-Oh!”,   icon: “👁”, color: “#a855f7”, accent: “#7c3aed”, type: “card”, ebayCategory: “183454” },
magic:       { label: “Magic”,        icon: “✦”,  color: “#3b82f6”, accent: “#1d4ed8”, type: “card”, ebayCategory: “183454” },
onepiece:    { label: “One Piece”,    icon: “☠”,  color: “#ef4444”, accent: “#b91c1c”, type: “card”, ebayCategory: “183454” },
electronics: { label: “Electronics”,  icon: “📱”, color: “#06b6d4”, accent: “#0891b2”, type: “item”, ebayCategory: “58058”  },
sneakers:    { label: “Sneakers”,     icon: “👟”, color: “#f97316”, accent: “#ea580c”, type: “item”, ebayCategory: “15709”  },
clothing:    { label: “Clothing”,     icon: “👕”, color: “#ec4899”, accent: “#db2777”, type: “item”, ebayCategory: “11450”  },
vintage:     { label: “Vintage”,      icon: “🏺”, color: “#84cc16”, accent: “#65a30d”, type: “item”, ebayCategory: “353”    },
toys:        { label: “Toys”,         icon: “🧸”, color: “#f59e0b”, accent: “#d97706”, type: “item”, ebayCategory: “220”    },
other:       { label: “Other”,        icon: “📦”, color: “#94a3b8”, accent: “#64748b”, type: “item”, ebayCategory: “99”     },
};

const CARD_CATS  = Object.entries(CATEGORIES).filter(([,v])=>v.type===“card”);
const ITEM_CATS  = Object.entries(CATEGORIES).filter(([,v])=>v.type===“item”);
const CONDITION_MAP = { NM:“Near Mint or Better”, LP:“Lightly Played”, MP:“Moderately Played”, New:“New”, LikeNew:“Like New”, Good:“Good”, Fair:“Fair”, Poor:“Poor” };
const CARD_CONDITIONS = [“NM”,“LP”,“MP”];
const ITEM_CONDITIONS = [“New”,“LikeNew”,“Good”,“Fair”,“Poor”];

// ── AI ────────────────────────────────────────────────────────────────────────
const callAI = async (messages, maxTokens=900) => {
const res = await fetch(“https://api.anthropic.com/v1/messages”, {
method:“POST”, headers:{“Content-Type”:“application/json”},
body: JSON.stringify({ model:“claude-sonnet-4-20250514”, max_tokens:maxTokens, messages }),
});
const data = await res.json();
if (data.error) throw new Error(data.error.message);
return data.content[0].text;
};
const parseJSON = (t) => JSON.parse(t.replace(/`json|`/g,””).trim());

// Compress image to max 800px wide, JPEG 0.7 quality — keeps it under API limits
const compressImage = (b64, mime) => new Promise((res) => {
const img = new Image();
img.onload = () => {
const MAX = 800;
const scale = Math.min(1, MAX / Math.max(img.width, img.height));
const w = Math.round(img.width * scale);
const h = Math.round(img.height * scale);
const canvas = document.createElement(“canvas”);
canvas.width = w; canvas.height = h;
canvas.getContext(“2d”).drawImage(img, 0, 0, w, h);
const compressed = canvas.toDataURL(“image/jpeg”, 0.7).split(”,”)[1];
res(compressed);
};
img.onerror = () => res(b64); // fallback to original
img.src = `data:${mime};base64,${b64}`;
});

// ── Shipping ──────────────────────────────────────────────────────────────────
// Preset package profiles per category (weight oz, dims inches)
const SHIP_PRESETS = {
pokemon:     { name:“PWE/Bubble Mailer”, weightOz:1.5,  l:6,  w:4,  h:0.5 },
yugioh:      { name:“PWE/Bubble Mailer”, weightOz:1.5,  l:6,  w:4,  h:0.5 },
magic:       { name:“PWE/Bubble Mailer”, weightOz:1.5,  l:6,  w:4,  h:0.5 },
onepiece:    { name:“PWE/Bubble Mailer”, weightOz:1.5,  l:6,  w:4,  h:0.5 },
electronics: { name:“Small Box”,        weightOz:16,   l:12, w:9,  h:4   },
sneakers:    { name:“Shoe Box”,         weightOz:48,   l:14, w:8,  h:5   },
clothing:    { name:“Poly Mailer”,      weightOz:12,   l:12, w:10, h:1   },
vintage:     { name:“Medium Box”,       weightOz:32,   l:12, w:12, h:8   },
toys:        { name:“Medium Box”,       weightOz:24,   l:12, w:10, h:6   },
other:       { name:“Small Box”,        weightOz:16,   l:10, w:8,  h:4   },
};

// USPS rate estimates (2025 approximate rates, domestic)
const calcUSPS = (weightOz, l, w, h) => {
const lb = weightOz / 16;
const girth = 2*(w+h);
const size = l + girth;

// First class mail (under 13oz)
if (weightOz <= 13) {
const base = weightOz <= 1 ? 0.68 : weightOz <= 2 ? 0.91 : weightOz <= 3 ? 1.14 : weightOz <= 4 ? 1.37 : weightOz <= 6 ? 1.70 : weightOz <= 8 ? 2.10 : weightOz <= 10 ? 2.50 : 2.89;
return { service:“USPS First Class”, cost: base + 0.20, days:“2-5” }; // +envelope/mailer
}
// Priority mail flat rate small box ~$9.85
if (l<=8.625 && w<=5.375 && h<=1.625) return { service:“USPS Priority Flat Rate Sm”, cost:9.85, days:“1-3” };
// Priority mail flat rate medium box ~$16.10
if (l<=11 && w<=8.5 && h<=5.5) return { service:“USPS Priority Flat Rate Med”, cost:16.10, days:“1-3” };
// Priority mail flat rate large ~$22.85
if (l<=12 && w<=12 && h<=5.5) return { service:“USPS Priority Flat Rate Lg”, cost:22.85, days:“1-3” };
// Priority mail by weight (simplified zones 1-4 avg)
if (lb <= 1)  return { service:“USPS Priority Mail”, cost:9.35,  days:“1-3” };
if (lb <= 2)  return { service:“USPS Priority Mail”, cost:10.40, days:“1-3” };
if (lb <= 3)  return { service:“USPS Priority Mail”, cost:11.75, days:“1-3” };
if (lb <= 5)  return { service:“USPS Priority Mail”, cost:14.50, days:“1-3” };
if (lb <= 10) return { service:“USPS Priority Mail”, cost:19.80, days:“1-3” };
return { service:“USPS Priority Mail”, cost:26.50, days:“1-3” };
};

const calcUPS = (weightOz, l, w, h) => {
const lb = Math.max(1, Math.ceil(weightOz/16));
// UPS Ground simplified (zone 2-4 avg)
const rates = [0,10.20,11.30,12.50,14.00,16.20,18.50,21.00,24.50,28.00,32.00];
const cost = lb <= 10 ? rates[lb] : 32 + (lb-10)*2.80;
return { service:“UPS Ground”, cost: parseFloat(cost.toFixed(2)), days:“1-5” };
};

const calcShipping = (weightOz, l, w, h) => {
const usps = calcUSPS(weightOz, l, w, h);
const ups  = calcUPS(weightOz, l, w, h);
const cheaper = usps.cost <= ups.cost ? usps : ups;
return { usps, ups, recommended: cheaper };
};

const estimateShipping = async (itemName, category) => {
const preset = SHIP_PRESETS[category] || SHIP_PRESETS.other;
const text = await callAI([{ role:“user”, content:`Estimate shipping package details for selling on eBay: "${itemName}" (category: ${CATEGORIES[category]?.label}). Return ONLY JSON with your best estimate: {"weightOz":${preset.weightOz},"l":${preset.l},"w":${preset.w},"h":${preset.h},"packageType":"${preset.name}","notes":"brief packaging tip"} weightOz = total weight including packaging. Adjust from defaults if this specific item would be heavier/lighter.` }], 300);
try { return parseJSON(text); } catch { return { weightOz:preset.weightOz, l:preset.l, w:preset.w, h:preset.h, packageType:preset.name, notes:”” }; }
};

const analyzeCard = async (content, game, isImage, mime) => {
const g = CATEGORIES[game];
const msg = isImage
? [{ type:“image”, source:{ type:“base64”, media_type:mime, data:content } }, { type:“text”, text:`You are a ${g.label} TCG pricing expert. Identify this card and give current eBay sold prices.\nReturn ONLY JSON:\n{"name":"full card name","set":"set","rarity":"rarity","nmPrice":0.00,"lpPrice":0.00,"mpPrice":0.00,"trend":"stable","notes":"one sentence","confidence":"high","ebayTitle":"optimized 80-char title"}` }]
: `You are a ${g.label} TCG expert. Identify: "${content}"\nReturn ONLY JSON: {"name":"full name","set":"set","rarity":"rarity","nmPrice":0.00,"lpPrice":0.00,"mpPrice":0.00,"trend":"stable","notes":"one sentence","ebayTitle":"optimized 80-char title"}`;
const text = await callAI([{ role:“user”, content: msg }]);
return parseJSON(text);
};

const analyzeItem = async (content, category, isImage, mime) => {
const g = CATEGORIES[category];
const msg = isImage
? [{ type:“image”, source:{ type:“base64”, media_type:mime, data:content } }, { type:“text”, text:`You are an eBay reselling expert specializing in ${g.label}. Identify this item from the photo and estimate current eBay sold prices.\nReturn ONLY JSON:\n{"name":"full item name/model","brand":"brand if visible","condition":"your assessment","lowPrice":0.00,"midPrice":0.00,"highPrice":0.00,"trend":"stable","notes":"one sentence market note","confidence":"high","ebayTitle":"optimized 80-char eBay title","suggestedCategory":"${g.label}"}` }]
: `You are an eBay reselling expert. I want to sell: "${content}" (category: ${g.label})\nReturn ONLY JSON: {"name":"full item name","brand":"brand","condition":"unknown","lowPrice":0.00,"midPrice":0.00,"highPrice":0.00,"trend":"stable","notes":"one sentence","ebayTitle":"optimized 80-char eBay title","suggestedCategory":"${g.label}"}`;
const text = await callAI([{ role:“user”, content: msg }]);
return parseJSON(text);
};

const genDescription = async (name, condition, category, extra={}) => {
const g = CATEGORIES[category];
const isCard = g.type===“card”;
const text = await callAI([{ role:“user”, content:`Write a professional eBay listing description for:\nItem: ${name}\nCategory: ${g.label}\nCondition: ${CONDITION_MAP[condition]||condition}\n${extra.brand?`Brand: ${extra.brand}`:""}${extra.set?`\nSet: ${extra.set}`:""}\n\nUnder 200 words. Include: condition, what's included, shipping mention. ${isCard?"Mention card is stored in sleeve/toploader.":""} Professional tone. No markdown.` }], 400);
return text.trim();
};

const optimizeListing = async (name, category, condition, extra={}) => {
const g = CATEGORIES[category];
const text = await callAI([{ role:“user”, content:`You are an expert eBay seller. Optimize a listing for: "${name}" (${g.label}, ${CONDITION_MAP[condition]||condition}). ${extra.brand?`Brand: ${extra.brand}`:""}${extra.set?`\nSet/Series: ${extra.set}`:””}

Return ONLY JSON:
{
“titles”: [
{“title”:“best title option 1 max 80 chars”,“score”:95,“reason”:“why this works”},
{“title”:“alt title option 2 max 80 chars”,“score”:88,“reason”:“why this works”},
{“title”:“alt title option 3 max 80 chars”,“score”:82,“reason”:“why this works”}
],
“keywords”: [“keyword1”,“keyword2”,“keyword3”,“keyword4”,“keyword5”,“keyword6”,“keyword7”,“keyword8”],
“categories”: [
{“id”:“183454”,“name”:“Primary category name”,“confidence”:“high”,“reason”:“why this fits”},
{“id”:“183454”,“name”:“Alt category name”,“confidence”:“medium”,“reason”:“alt option”}
],
“itemSpecifics”: {“Brand”:””,“Set”:””,“Rarity”:””,“Condition”:””,“Type”:””},
“pricingTip”: “one sentence pricing insight for this specific item”,
“titleTips”: [“tip 1 for this item”,“tip 2”,“tip 3”]
}
For categories use real eBay category IDs. Cards: 183454. Electronics: 58058. Sneakers: 15709. Clothing: 11450. Toys: 220. Collectibles: 1. Vintage: 353.` }], 1200);
return parseJSON(text);
};

const scoutItem = async (content, isImage, mime, askPrice) => {
const msg = isImage
? [
{ type:“image”, source:{ type:“base64”, media_type:mime, data:content } },
{ type:“text”, text:`You are an expert eBay reseller and flipper. Analyze this item from the photo. ${askPrice ? `The seller is asking $${askPrice}.` : “No asking price provided.”}

Identify what this is and give a complete buy/pass analysis.
Return ONLY JSON:
{
“name”: “full item name/model”,
“category”: “one of: pokemon/yugioh/magic/onepiece/electronics/sneakers/clothing/vintage/toys/other”,
“confidence”: “high/medium/low”,
“lowSell”: 0.00,
“midSell”: 0.00,
“highSell”: 0.00,
“verdict”: “BUY / PASS / NEGOTIATE”,
“verdictReason”: “one clear sentence why”,
“maxPayPrice”: 0.00,
“estimatedProfit”: 0.00,
“riskLevel”: “low/medium/high”,
“riskReason”: “why this risk level”,
“demandLevel”: “hot/steady/slow”,
“timeToSell”: “1-3 days / 1-2 weeks / 1+ month”,
“tips”: [“tip 1”, “tip 2”, “tip 3”],
“redFlags”: [“any red flag or empty array if none”],
“conditionNotes”: “what you can see about condition from the photo”
}
Be direct and practical. maxPayPrice should include room for eBay fees (~13%) and still make $5+ profit minimum.`} ] :`You are an expert eBay reseller. I’m thinking about buying: “${content}”${askPrice?` asking price $${askPrice}`:””}.
Return ONLY JSON:
{“name”:“full name”,“category”:“pokemon/yugioh/magic/onepiece/electronics/sneakers/clothing/vintage/toys/other”,“confidence”:“high”,“lowSell”:0.00,“midSell”:0.00,“highSell”:0.00,“verdict”:“BUY / PASS / NEGOTIATE”,“verdictReason”:“one sentence”,“maxPayPrice”:0.00,“estimatedProfit”:0.00,“riskLevel”:“low/medium/high”,“riskReason”:“why”,“demandLevel”:“hot/steady/slow”,“timeToSell”:“estimate”,“tips”:[“tip1”,“tip2”],“redFlags”:[],“conditionNotes”:“unknown from description”}`;

const text = await callAI([{ role:“user”, content: msg }], 1000);
return parseJSON(text);
};

const getPhotoChecklist = (category, itemName=””) => {
const base = {
pokemon:     [“Front of card (centered, good lighting)”, “Back of card”, “Close-up of any damage/whitening on edges”, “Card in toploader/sleeve”, “Any holographic/foil detail shot”],
yugioh:      [“Front of card (centered)”, “Back of card”, “Close-up of card number/edition”, “Any damage close-up”, “Card in sleeve”],
magic:       [“Front of card”, “Back of card”, “Close-up of set symbol & collector number”, “Any wear close-up”, “Card in sleeve”],
onepiece:    [“Front of card”, “Back of card”, “Close-up of card number/parallel indicator”, “Any damage”, “Card in sleeve”],
electronics: [“Front face/screen on”, “Back/bottom”, “All ports & inputs”, “Any scratches/damage close-up”, “Box & accessories if included”, “Serial number sticker”, “Powered on/working shot”],
sneakers:    [“Side profile left shoe”, “Side profile right shoe”, “Top-down both shoes”, “Sole/outsole”, “Heel & back”, “Inside/insole”, “Toe box close-up”, “Any wear/damage”, “Size tag”, “Box label if included”],
clothing:    [“Front flat lay”, “Back flat lay”, “Label/tag (brand & size)”, “Any flaws close-up”, “Material texture”, “Measurements if notable”],
vintage:     [“Full item front”, “Full item back/bottom”, “Maker’s mark or stamp”, “Any chips/cracks/damage”, “Size reference (with common object)”, “Detail shots of key features”],
toys:        [“Item out of box”, “Box front”, “Box back/condition”, “All included pieces”, “Any damage”, “Working/functional demo if possible”],
other:       [“Full item from multiple angles”, “Any brand/model markings”, “Any damage or wear”, “Scale reference”, “Accessories/extras included”],
};
return base[category] || base.other;
};

const fileToBase64 = (file) => new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(”,”)[1]); r.onerror=rej; r.readAsDataURL(file); });

// ── CSV ───────────────────────────────────────────────────────────────────────
const CSV_HEADERS = [“Title”,“Category”,“Format”,“StartPrice”,“Quantity”,“ConditionID”,“ConditionDescription”,“Description”,“ShippingProfileName”,“ReturnProfileName”,“PaymentProfileName”,“Location”,“Currency”,“CustomLabel”].join(”,”);

const buildRow = (flip, desc, settings) => {
const price = ((flip.midPrice||flip.lpPrice||0) * (1+(settings.markup||10)/100)).toFixed(2);
const condId = (flip.condition===“New”||flip.condition===“NM”)?“1000”:flip.condition===“LikeNew”?“1500”:“3000”;
return [
`"${(flip.listedTitle||flip.name||"").slice(0,80)}"`,
`"${CATEGORIES[flip.category]?.ebayCategory||"99"}"`,
`"Fixed Price"`, `"${price}"`, `"1"`,
`"${condId}"`, `"${CONDITION_MAP[flip.condition]||flip.condition}"`,
`"${(desc||"").replace(/"/g,"'")}"`,
`"${settings.shippingPolicy||""}"`, `"${settings.returnPolicy||""}"`, `"${settings.paymentPolicy||""}"`,
`"${settings.location||"United States"}"`, `"USD"`, `"${flip.name||""}"`,
].join(”,”);
};

const downloadCSV = (rows) => {
const csv=[CSV_HEADERS,…rows].join(”\n”);
const blob=new Blob([csv],{type:“text/csv”});
const url=URL.createObjectURL(blob);
const a=document.createElement(“a”); a.href=url; a.download=`flippro-ebay-${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url);
};

// ── UI ────────────────────────────────────────────────────────────────────────
const Pill = ({label,color=”#f0c040”}) => (
<span style={{background:color+“22”,color,border:`1px solid ${color}44`,borderRadius:99,padding:“2px 10px”,fontSize:11,fontWeight:700,letterSpacing:0.5,textTransform:“uppercase”}}>{label}</span>
);
const trendColor = (t) => t===“rising”?”#4ade80”:t===“falling”?”#f87171”:”#94a3b8”;
const trendIcon  = (t) => t===“rising”?“↑”:t===“falling”?“↓”:“→”;
const CatBadge   = ({cat}) => { const g=CATEGORIES[cat]||CATEGORIES.other; return <Pill label={`${g.icon} ${g.label}`} color={g.color}/>; };

const S = {
app:  {minHeight:“100vh”,background:”#0a0a0f”,color:”#e2e8f0”,fontFamily:”‘Syne’,sans-serif”,padding:0},
hdr:  {background:“linear-gradient(135deg,#0f0f1a,#1a1028)”,borderBottom:“1px solid #ffffff10”,padding:“20px 20px 0”},
logo: {fontSize:22,fontWeight:900,letterSpacing:-1,background:“linear-gradient(90deg,#f0c040,#06b6d4)”,WebkitBackgroundClip:“text”,WebkitTextFillColor:“transparent”,marginBottom:4},
sub:  {color:”#64748b”,fontSize:12,marginBottom:16},
srow: {display:“flex”,gap:20,marginBottom:0,flexWrap:“wrap”},
tabs: {display:“flex”,gap:0,marginTop:16,overflowX:“auto”},
tab:  (a,c=”#f0c040”)=>({padding:“10px 14px”,background:“none”,border:“none”,borderBottom:a?`2px solid ${c}`:“2px solid transparent”,color:a?c:”#64748b”,fontWeight:700,fontSize:12,cursor:“pointer”,whiteSpace:“nowrap”,transition:“all 0.2s”}),
wrap: {padding:“20px 16px”,maxWidth:700,margin:“0 auto”},
card: {background:”#0f0f1a”,border:“1px solid #ffffff0f”,borderRadius:16,padding:20,marginBottom:16},
inp:  {width:“100%”,background:”#ffffff08”,border:“1px solid #ffffff15”,borderRadius:10,padding:“12px 14px”,color:”#e2e8f0”,fontSize:14,outline:“none”,boxSizing:“border-box”,fontFamily:“inherit”},
btn:  (v=“primary”,c=”#f0c040”,a=”#ff6b35”)=>({
padding:“11px 18px”,borderRadius:10,border:“none”,fontWeight:700,fontSize:13,cursor:“pointer”,whiteSpace:“nowrap”,
background:v===“primary”?`linear-gradient(135deg,${c},${a})`:v===“danger”?”#ef444422”:v===“cam”?“linear-gradient(135deg,#0ea5e9,#6366f1)”:v===“ebay”?“linear-gradient(135deg,#e53238,#f5af02)”:”#ffffff0a”,
color:v===“primary”||v===“cam”||v===“ebay”?”#fff”:v===“danger”?”#f87171”:”#94a3b8”,
}),
lbl:  {fontSize:11,color:”#64748b”,textTransform:“uppercase”,letterSpacing:1,marginBottom:6,display:“block”},
pg:   {display:“grid”,gridTemplateColumns:“1fr 1fr 1fr”,gap:10,marginTop:12},
pb:   (c)=>({background:c+“11”,border:`1px solid ${c}33`,borderRadius:10,padding:“10px 12px”,textAlign:“center”}),
fc:   {background:”#0f0f1a”,border:“1px solid #ffffff0f”,borderRadius:14,padding:16,marginBottom:12},
};

// ── Category Picker ───────────────────────────────────────────────────────────
function CategoryPicker({ value, onChange }) {
return (
<div>
<label style={S.lbl}>TCG Cards</label>
<div style={{display:“grid”,gridTemplateColumns:“repeat(4,1fr)”,gap:8,marginBottom:12}}>
{CARD_CATS.map(([key,g])=>(
<button key={key} onClick={()=>onChange(key)} style={{padding:“10px 8px”,borderRadius:12,border:value===key?`2px solid ${g.color}`:“2px solid #ffffff10”,background:value===key?g.color+“15”:”#ffffff05”,color:value===key?g.color:”#64748b”,fontWeight:700,fontSize:11,cursor:“pointer”,textAlign:“center”,transition:“all 0.2s”}}>
<div style={{fontSize:20,marginBottom:4}}>{g.icon}</div>
<div style={{lineHeight:1.2}}>{g.label}</div>
</button>
))}
</div>
<label style={S.lbl}>General Items</label>
<div style={{display:“grid”,gridTemplateColumns:“repeat(3,1fr)”,gap:8}}>
{ITEM_CATS.map(([key,g])=>(
<button key={key} onClick={()=>onChange(key)} style={{padding:“10px 8px”,borderRadius:12,border:value===key?`2px solid ${g.color}`:“2px solid #ffffff10”,background:value===key?g.color+“15”:”#ffffff05”,color:value===key?g.color:”#64748b”,fontWeight:700,fontSize:11,cursor:“pointer”,textAlign:“center”,transition:“all 0.2s”}}>
<div style={{fontSize:20,marginBottom:4}}>{g.icon}</div>
<div style={{lineHeight:1.2}}>{g.label}</div>
</button>
))}
</div>
</div>
);
}

function FilterBar({ value, onChange }) {
return (
<div style={{display:“flex”,gap:8,marginBottom:16,overflowX:“auto”,paddingBottom:4}}>
{[[“all”,“All”,”#94a3b8”],…Object.entries(CATEGORIES).map(([k,g])=>[k,`${g.icon} ${g.label}`,g.color])].map(([key,lbl,color])=>(
<button key={key} onClick={()=>onChange(key)} style={{padding:“6px 14px”,borderRadius:99,border:value===key?`2px solid ${color}`:“2px solid #ffffff10”,background:value===key?color+“22”:“none”,color:value===key?color:”#64748b”,fontWeight:700,fontSize:12,cursor:“pointer”,whiteSpace:“nowrap”}}>{lbl}</button>
))}
</div>
);
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
const [tab, setTab]     = useState(“scout”);
const [flips, setFlips] = useState([]);
const [budget, setBudget] = useState(0);
const [filter, setFilter] = useState(“all”);
const [ebaySettings, setEbaySettings] = useState({shippingPolicy:””,returnPolicy:””,paymentPolicy:””,location:“United States”,markup:10});
const [spending, setSpending] = useState([]);

useEffect(()=>{
try {
const s=localStorage.getItem(STORAGE_KEY); if(s) setFlips(JSON.parse(s));
const b=localStorage.getItem(BUDGET_KEY);  if(b) setBudget(parseFloat(b));
const e=localStorage.getItem(EBAY_KEY);    if(e) setEbaySettings(JSON.parse(e));
const sp=localStorage.getItem(SPEND_KEY);  if(sp) setSpending(JSON.parse(sp));
} catch {}
},[]);

const saveFlips   = (f)=>{ setFlips(f); try{localStorage.setItem(STORAGE_KEY,JSON.stringify(f));}catch{} };
const saveBudget  = (b)=>{ setBudget(b); try{localStorage.setItem(BUDGET_KEY,String(b));}catch{} };
const saveEbay    = (e)=>{ setEbaySettings(e); try{localStorage.setItem(EBAY_KEY,JSON.stringify(e));}catch{} };
const saveSpending= (s)=>{ setSpending(s); try{localStorage.setItem(SPEND_KEY,JSON.stringify(s));}catch{} };
const addFlip    = (f)=>saveFlips([f,…flips]);
const updateFlip = (id,u)=>saveFlips(flips.map(f=>f.id===id?{…f,…u}:f));
const deleteFlip = (id)=>saveFlips(flips.filter(f=>f.id!==id));

const active   = flips.filter(f=>f.status!==“sold”);
const sold     = flips.filter(f=>f.status===“sold”);
const invested = active.reduce((s,f)=>s+(f.buyPrice||0),0);
const profit   = sold.reduce((s,f)=>s+((f.sellPrice||0)-(f.buyPrice||0)),0);
const fActive  = active.filter(f=>filter===“all”||f.category===filter);
const fSold    = sold.filter(f=>filter===“all”||f.category===filter);

return (
<div style={S.app}>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800;900&display=swap" rel="stylesheet"/>
<div style={S.hdr}>
<div style={S.logo}>⚡ FlipPro</div>
<div style={S.sub}>Cards · Electronics · Sneakers · Clothing · Vintage · Anything</div>
<div style={S.srow}>
{[[active.length,“Active”,”#f0c040”],[`${profit>=0?"+":""}$${Math.abs(profit).toFixed(0)}`,“Profit”,profit>=0?”#4ade80”:”#f87171”],[`$${invested.toFixed(0)}`,“Invested”,”#f0c040”],[`$${budget.toFixed(0)}`,“Budget”,”#60a5fa”]].map(([v,l,c])=>(
<div key={l}>
<div style={{fontSize:20,fontWeight:800,color:c}}>{v}</div>
<div style={{fontSize:10,color:”#475569”,textTransform:“uppercase”,letterSpacing:1}}>{l}</div>
</div>
))}
</div>
<div style={S.tabs}>
{[[“scout”,“🤔 Scout”],[“scanner”,“📷 Scan”],[“active”,“📦 Active”],[“sold”,“💰 Sold”],[“list”,“📝 List”],[“shipping”,“🚚 Ship”],[“spend”,“💸 Spending”],[“budget”,“💵 Budget”],[“ebay”,“🛒 eBay”]].map(([t,lbl])=>(
<button key={t} style={S.tab(tab===t,t===“ebay”?”#e53238”:t===“shipping”?”#22c55e”:t===“list”?”#a78bfa”:t===“scout”?”#f472b6”:t===“spend”?”#fb923c”:”#f0c040”)} onClick={()=>setTab(t)}>{lbl}</button>
))}
</div>
</div>
<div style={S.wrap}>
{tab===“scout”    && <ScoutTab/>}
{tab===“scanner”  && <ScannerTab onAddFlip={addFlip}/>}
{tab===“active”   && <FlipsTab flips={fActive} onUpdate={updateFlip} onDelete={deleteFlip} label="Active" filter={filter} onFilter={setFilter}/>}
{tab===“sold”     && <FlipsTab flips={fSold}   onUpdate={updateFlip} onDelete={deleteFlip} label="Sold" showProfit filter={filter} onFilter={setFilter}/>}
{tab===“list”     && <ListTab/>}
{tab===“shipping” && <ShippingTab/>}
{tab===“spend”    && <SpendingTab spending={spending} onSave={saveSpending} flips={flips}/>}
{tab===“budget”   && <BudgetTab budget={budget} onSave={saveBudget} invested={invested} profit={profit} flips={flips}/>}
{tab===“ebay”     && <EbayTab flips={active} settings={ebaySettings} onSaveSettings={saveEbay}/>}
</div>
</div>
);
}

// ── Scanner Tab ───────────────────────────────────────────────────────────────
function ScannerTab({ onAddFlip }) {
const [category, setCat]        = useState(“pokemon”);
const [mode, setMode]           = useState(“camera”);
const [input, setInput]         = useState(””);
const [buyPrice, setBuyPrice]   = useState(””);
const [loading, setLoading]     = useState(false);
const [result, setResult]       = useState(null);
const [condition, setCondition] = useState(“LP”);
const [listing, setListing]     = useState(””);
const [copied, setCopied]       = useState(false);
const [error, setError]         = useState(””);
const [preview, setPreview]     = useState(null);
const [imgData, setImgData]     = useState(null);
const [imgMime, setImgMime]     = useState(null);
const videoRef  = useRef(null);
const canvasRef = useRef(null);
const streamRef = useRef(null);
const fileRef   = useRef(null);
const fileRef2  = useRef(null);
const [camOn, setCamOn]   = useState(false);
const [camErr, setCamErr] = useState(“camera_failed”); // default to upload in app
const [facing, setFacing] = useState(“environment”);

const g       = CATEGORIES[category];
const isCard  = g.type===“card”;
const conds   = isCard ? CARD_CONDITIONS : ITEM_CONDITIONS;

// reset condition when category type changes
useEffect(()=>{ setCondition(isCard?“LP”:“Good”); setResult(null); setError(””); setListing(””); },[isCard]);

const startCam = async ()=>{
setCamErr(””);
try {
if(streamRef.current) stopCam();
const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:facing,width:{ideal:1280},height:{ideal:720}}});
streamRef.current=stream;
if(videoRef.current){videoRef.current.srcObject=stream;videoRef.current.play();}
setCamOn(true);
} catch { setCamErr(“camera_failed”); }
};
const stopCam=()=>{ if(streamRef.current){streamRef.current.getTracks().forEach(t=>t.stop());streamRef.current=null;} if(videoRef.current)videoRef.current.srcObject=null; setCamOn(false); };
const flipCam=()=>{ setFacing(f=>f===“environment”?“user”:“environment”); stopCam(); setTimeout(startCam,200); };
const capture=()=>{
const v=videoRef.current,c=canvasRef.current; if(!v||!c)return;
c.width=v.videoWidth;c.height=v.videoHeight;c.getContext(“2d”).drawImage(v,0,0);
const url=c.toDataURL(“image/jpeg”,0.9);
setPreview(url);setImgData(url.split(”,”)[1]);setImgMime(“image/jpeg”);
stopCam();setResult(null);setError(””);setListing(””);
};
const handleFile=async(file)=>{
if(!file)return;
const b64=await fileToBase64(file);
const mime=file.type||“image/jpeg”;
setPreview(`data:${mime};base64,${b64}`);
setImgData(b64);setImgMime(mime);
setResult(null);setError(””);setListing(””);stopCam();
};
const resetImg=()=>{ setPreview(null);setImgData(null);setImgMime(null);setResult(null);setError(””);stopCam(); };

const identify=async()=>{
setLoading(true);setResult(null);setError(””);setListing(””);
try {
let imagePayload = imgData;
if (mode===“camera” && imgData) {
imagePayload = await compressImage(imgData, imgMime);
}
let d;
if(mode===“camera”){
d = isCard ? await analyzeCard(imagePayload,category,true,“image/jpeg”) : await analyzeItem(imagePayload,category,true,“image/jpeg”);
} else {
d = isCard ? await analyzeCard(input,category,false) : await analyzeItem(input,category,false);
}
if(d.cardName) d.name=d.name||d.cardName;
if(d.nmPrice)  { d.highPrice=d.nmPrice;d.midPrice=d.lpPrice;d.lowPrice=d.mpPrice; }
setResult(d);
} catch(e) { setError(“Couldn’t identify — try the Type It button instead.”); }
setLoading(false);
};

const sellPrice = result ? (isCard ? (condition===“NM”?result.highPrice:condition===“LP”?result.midPrice:result.lowPrice)||0 : result.midPrice||0) : 0;
const estProfit = sellPrice-(parseFloat(buyPrice)||0)-sellPrice*0.13;
const pc        = estProfit>=0?”#4ade80”:”#f87171”;

const addToFlips=()=>{
if(!result)return;
onAddFlip({
id:Date.now(), category,
name: result.name||result.cardName||input,
brand: result.brand||””,
set: result.set||””, rarity: result.rarity||””,
condition,
buyPrice: parseFloat(buyPrice)||0,
lowPrice: result.lowPrice||result.mpPrice||0,
midPrice: result.midPrice||result.lpPrice||0,
highPrice: result.highPrice||result.nmPrice||0,
trend: result.trend||“stable”,
notes: result.notes||””,
status:“active”,
listedTitle: listing||result.ebayTitle||result.name||””,
ebayCategory: CATEGORIES[category].ebayCategory,
addedAt: new Date().toISOString(),
});
setInput(””);setBuyPrice(””);setResult(null);setListing(””);setError(””);setPreview(null);setImgData(null);stopCam();
};

const copy=()=>{ navigator.clipboard.writeText(listing);setCopied(true);setTimeout(()=>setCopied(false),2000); };

return (
<div>
<div style={S.card}>
<label style={S.lbl}>What are you listing?</label>
<CategoryPicker value={category} onChange={(c)=>{ setCat(c); setResult(null);setError(””);setListing(””);resetImg(); }}/>

```
    <div style={{display:"flex",gap:8,marginTop:16,marginBottom:16}}>
      {[["camera","📷 Photo / Camera"],["text","⌨️ Type It"]].map(([m,lbl])=>(
        <button key={m} onClick={()=>{setMode(m);resetImg();setInput("");setError("");}} style={{flex:1,padding:"10px",borderRadius:10,border:mode===m?`2px solid ${g.color}`:"2px solid #ffffff10",background:mode===m?g.color+"15":"#ffffff05",color:mode===m?g.color:"#64748b",fontWeight:700,fontSize:13,cursor:"pointer"}}>{lbl}</button>
      ))}
    </div>

    {mode==="camera" && (
      <div>
        {preview ? (
          <div style={{position:"relative",marginBottom:12}}>
            <img src={preview} alt="item" style={{width:"100%",borderRadius:12,maxHeight:300,objectFit:"contain",background:"#111"}}/>
            <button onClick={resetImg} style={{position:"absolute",top:8,right:8,background:"#000000aa",border:"none",borderRadius:99,color:"#fff",width:32,height:32,cursor:"pointer",fontSize:16}}>✕</button>
          </div>
        ) : camOn ? (
          <div style={{position:"relative",marginBottom:12}}>
            <video ref={videoRef} style={{width:"100%",borderRadius:12,maxHeight:300,objectFit:"cover",background:"#111",display:"block"}} playsInline muted/>
            <canvas ref={canvasRef} style={{display:"none"}}/>
            <div style={{position:"absolute",bottom:10,left:0,right:0,display:"flex",justifyContent:"center",gap:12}}>
              <button onClick={capture}  style={{background:"#fff",border:"4px solid #ffffff88",borderRadius:99,width:60,height:60,cursor:"pointer",fontSize:24}}>📸</button>
              <button onClick={flipCam}  style={{background:"#000000aa",border:"none",borderRadius:99,width:44,height:44,cursor:"pointer",color:"#fff",fontSize:20}}>🔄</button>
              <button onClick={stopCam}  style={{background:"#ef444488",border:"none",borderRadius:99,width:44,height:44,cursor:"pointer",color:"#fff",fontSize:20}}>✕</button>
            </div>
          </div>
        ) : (
          <div style={{border:`2px dashed ${camErr==="camera_failed"?"#f8717130":"#ffffff15"}`,borderRadius:12,padding:32,textAlign:"center",marginBottom:12,background:camErr==="camera_failed"?"#f8717108":"transparent"}}>
            {camErr==="camera_failed" ? (
              <>
                <div style={{fontSize:40,marginBottom:8}}>📁</div>
                <div style={{color:"#f87171",fontSize:13,fontWeight:700,marginBottom:4}}>Camera not available here</div>
                <div style={{color:"#64748b",fontSize:12,marginBottom:14}}>Upload from your photo library — works the same!</div>
              </>
            ) : (
              <>
                <div style={{fontSize:48,marginBottom:8}}>{g.icon}</div>
                <div style={{color:"#64748b",fontSize:13,marginBottom:16}}>
                  {isCard ? "Photo or upload a card image" : `Photo or upload an image of your ${g.label.toLowerCase()}`}
                </div>
              </>
            )}
            <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
              {camErr!=="camera_failed" && <button style={S.btn("cam")} onClick={startCam}>📷 Open Camera</button>}
              <button style={{...S.btn("primary",g.color,g.accent)}} onClick={()=>fileRef.current?.click()}>📁 Upload Photo</button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
          </div>
        )}
        {preview && (
          <>
            {!result && <button style={{...S.btn("primary",g.color,g.accent),width:"100%",marginBottom:8}} onClick={identify} disabled={loading}>{loading?"⏳ Analyzing...":`${g.icon} ${isCard?"Identify Card":"Analyze Item"}`}</button>}
            <div style={{display:"flex",gap:8}}>
              <button style={{...S.btn("ghost"),flex:1}} onClick={()=>{resetImg();startCam();}}>🔄 Retake</button>
              <button style={{...S.btn("ghost"),flex:1}} onClick={()=>fileRef2.current?.click()}>📁 New Photo</button>
              <input ref={fileRef2} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
            </div>
          </>
        )}
      </div>
    )}

    {mode==="text" && (
      <div>
        <label style={S.lbl}>{isCard?"Card name / description":"Item name, brand, model"}</label>
        <textarea style={{...S.inp,minHeight:72,resize:"vertical",marginBottom:12}}
          placeholder={
            category==="pokemon"?"e.g. 'Charizard GX full art rainbow'":
            category==="yugioh"?"e.g. 'Dark Magician Girl secret rare'":
            category==="magic"?"e.g. 'Black Lotus Alpha'":
            category==="onepiece"?"e.g. 'Luffy Gear 5 secret rare OP05'":
            category==="electronics"?"e.g. 'iPhone 13 Pro 256GB Space Gray'":
            category==="sneakers"?"e.g. 'Nike Air Jordan 1 Retro High OG Chicago size 10'":
            category==="clothing"?"e.g. 'Supreme Box Logo Hoodie Large Red FW21'":
            category==="vintage"?"e.g. '1960s Pyrex mixing bowl set primary colors'":
            category==="toys"?"e.g. 'LEGO Star Wars Millennium Falcon 75257 sealed'":
            "e.g. describe the item with brand, model, and any key details"
          }
          value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&(e.preventDefault(),identify())}
        />
        <button style={{...S.btn("primary",g.color,g.accent),width:"100%"}} onClick={identify} disabled={loading}>
          {loading?"⏳ Analyzing...":`${g.icon} ${isCard?"Identify & Price":"Research & Price"}`}
        </button>
      </div>
    )}
    {error && <div style={{marginTop:10,color:"#f87171",fontSize:13}}>⚠ {error}</div>}
  </div>

  {result && (
    <div style={{...S.card,borderColor:g.color+"44"}}>
      {result.confidence && <div style={{fontSize:11,color:result.confidence==="high"?"#4ade80":"#f0c040",marginBottom:6}}>{result.confidence==="high"?"✓ High confidence":"⚠ Verify before listing"}</div>}
      <div style={{fontWeight:800,fontSize:17,marginBottom:4}}>{result.name}</div>
      {result.brand && <div style={{fontSize:13,color:"#94a3b8",marginBottom:8}}>{result.brand}</div>}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
        <CatBadge cat={category}/>
        {result.set    && <Pill label={result.set}    color="#60a5fa"/>}
        {result.rarity && <Pill label={result.rarity} color={g.color}/>}
        {result.trend  && <Pill label={`${trendIcon(result.trend)} ${result.trend}`} color={trendColor(result.trend)}/>}
      </div>
      {result.notes && <div style={{background:"#ffffff08",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#94a3b8",marginBottom:12}}>💡 {result.notes}</div>}

      <div style={S.pg}>
        {[["Low",(result.lowPrice||0),"#f87171"],["Mid",(result.midPrice||0),"#f0c040"],["High",(result.highPrice||0),"#4ade80"]].map(([l,p,c])=>(
          <div key={l} style={S.pb(c)}>
            <div style={{fontSize:10,color:c,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{l}</div>
            <div style={{fontSize:20,fontWeight:800,color:c}}>${(p||0).toFixed(2)}</div>
          </div>
        ))}
      </div>

      {!isCard && result.midPrice>0 && (
        <div style={{marginTop:8,fontSize:11,color:"#475569",textAlign:"center"}}>Prices based on recent eBay sold listings</div>
      )}

      <div style={{marginTop:16,display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div>
          <label style={S.lbl}>Condition</label>
          <select style={S.inp} value={condition} onChange={e=>setCondition(e.target.value)}>
            {conds.map(c=><option key={c} value={c}>{CONDITION_MAP[c]||c}</option>)}
          </select>
        </div>
        <div>
          <label style={S.lbl}>Your Buy Price ($)</label>
          <input style={S.inp} type="number" placeholder="0.00" value={buyPrice} onChange={e=>setBuyPrice(e.target.value)}/>
        </div>
      </div>

      {buyPrice && (
        <div style={{marginTop:12,background:estProfit>=0?"#4ade8011":"#f8717111",border:`1px solid ${pc}33`,borderRadius:10,padding:"10px 14px"}}>
          <div style={{display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:13,color:"#94a3b8"}}>Est. profit after ~13% eBay fees</span>
            <span style={{fontWeight:800,color:pc}}>{estProfit>=0?"+":""}${estProfit.toFixed(2)}</span>
          </div>
          <div style={{fontSize:11,color:"#475569",marginTop:4}}>Sell ${sellPrice.toFixed(2)} − Buy ${(parseFloat(buyPrice)||0).toFixed(2)} − Fees ${(sellPrice*0.13).toFixed(2)}</div>
        </div>
      )}

      {result.ebayTitle && (
        <div style={{marginTop:12}}>
          <label style={S.lbl}>eBay Listing Title</label>
          <div style={{display:"flex",gap:8}}>
            <input style={{...S.inp,flex:1}} value={listing||result.ebayTitle} onChange={e=>setListing(e.target.value)}/>
            <button style={S.btn("ghost")} onClick={()=>{ setListing(listing||result.ebayTitle); copy(); }}>{copied?"✓":"Copy"}</button>
          </div>
          <div style={{fontSize:11,color:(listing||result.ebayTitle||"").length>80?"#f87171":"#475569",marginTop:4}}>{(listing||result.ebayTitle||"").length}/80</div>
        </div>
      )}

      <div style={{marginTop:14,display:"flex",gap:10,flexWrap:"wrap"}}>
        <button style={S.btn("primary",g.color,g.accent)} onClick={addToFlips}>+ Add to Flips</button>
      </div>
    </div>
  )}
</div>
```

);
}

// ── Flips Tab ─────────────────────────────────────────────────────────────────
function FlipsTab({ flips, onUpdate, onDelete, label, showProfit, filter, onFilter }) {
const [editing,setEditing]     = useState(null);
const [sellPrice,setSellPrice] = useState(””);

const markSold    = (f)=>{ setEditing(f.id);setSellPrice(String(f.midPrice||f.lpPrice||””)); };
const confirmSold = (f)=>{ onUpdate(f.id,{status:“sold”,sellPrice:parseFloat(sellPrice)||0,soldAt:new Date().toISOString()});setEditing(null); };

return (
<div>
<FilterBar value={filter} onChange={onFilter}/>
{flips.length===0 ? (
<div style={{…S.card,textAlign:“center”,padding:40}}>
<div style={{fontSize:40,marginBottom:12}}>📭</div>
<div style={{color:”#64748b”}}>No {label.toLowerCase()} yet</div>
</div>
) : (
<>
<div style={{fontSize:13,color:”#64748b”,marginBottom:12}}>{flips.length} item{flips.length!==1?“s”:””}</div>
{flips.map(flip=>{
const g=CATEGORIES[flip.category]||CATEGORIES.other;
const profit    = (flip.sellPrice||0)-(flip.buyPrice||0);
const potProfit = (flip.midPrice||0)-(flip.buyPrice||0)-((flip.midPrice||0)*0.13);
return (
<div key={flip.id} style={{…S.fc,borderLeft:`3px solid ${g.color}55`}}>
<div style={{display:“flex”,justifyContent:“space-between”,alignItems:“flex-start”}}>
<div style={{flex:1,minWidth:0}}>
<div style={{fontWeight:700,fontSize:14,marginBottom:4,whiteSpace:“nowrap”,overflow:“hidden”,textOverflow:“ellipsis”}}>{flip.name}</div>
{flip.brand && <div style={{fontSize:11,color:”#64748b”,marginBottom:6}}>{flip.brand}</div>}
<div style={{display:“flex”,gap:6,flexWrap:“wrap”,marginBottom:8}}>
<CatBadge cat={flip.category}/>
<Pill label={CONDITION_MAP[flip.condition]||flip.condition} color="#60a5fa"/>
{flip.rarity && <Pill label={flip.rarity} color={g.color}/>}
{flip.trend  && <Pill label={`${trendIcon(flip.trend)} ${flip.trend}`} color={trendColor(flip.trend)}/>}
</div>
<div style={{display:“flex”,gap:16,fontSize:13,flexWrap:“wrap”}}>
<span style={{color:”#94a3b8”}}>Paid <span style={{color:”#e2e8f0”,fontWeight:700}}>${(flip.buyPrice||0).toFixed(2)}</span></span>
{showProfit&&flip.sellPrice ? (
<span style={{color:”#94a3b8”}}>Sold <span style={{color:”#4ade80”,fontWeight:700}}>${flip.sellPrice.toFixed(2)}</span> <span style={{color:profit>=0?”#4ade80”:”#f87171”}}>({profit>=0?”+”:””}${profit.toFixed(2)})</span></span>
) : (
<span style={{color:”#94a3b8”}}>Est. profit <span style={{color:potProfit>=0?”#4ade80”:”#f87171”,fontWeight:700}}>{potProfit>=0?”+”:””}${potProfit.toFixed(2)}</span></span>
)}
</div>
{flip.notes && <div style={{fontSize:11,color:”#475569”,marginTop:6}}>💡 {flip.notes}</div>}
</div>
<div style={{display:“flex”,gap:6,marginLeft:12}}>
{!showProfit && editing!==flip.id && <button style={S.btn(“primary”,g.color,g.accent)} onClick={()=>markSold(flip)}>Sold</button>}
<button style={S.btn(“danger”)} onClick={()=>onDelete(flip.id)}>✕</button>
</div>
</div>
{editing===flip.id && (
<div style={{marginTop:12,padding:12,background:”#ffffff05”,borderRadius:10}}>
<label style={S.lbl}>Sold Price ($)</label>
<div style={{display:“flex”,gap:8}}>
<input style={{…S.inp,flex:1}} type=“number” value={sellPrice} onChange={e=>setSellPrice(e.target.value)}/>
<button style={S.btn(“primary”,g.color,g.accent)} onClick={()=>confirmSold(flip)}>Confirm</button>
<button style={S.btn(“ghost”)} onClick={()=>setEditing(null)}>Cancel</button>
</div>
</div>
)}
</div>
);
})}
</>
)}
</div>
);
}

// ── Scout Tab — “Should I buy this?” ─────────────────────────────────────────
function ScoutTab() {
const [mode, setMode]       = useState(“camera”);
const [askPrice, setAsk]    = useState(””);
const [input, setInput]     = useState(””);
const [loading, setLoading] = useState(false);
const [result, setResult]   = useState(null);
const [error, setError]     = useState(””);
const [preview, setPreview] = useState(null);
const [imgData, setImgData] = useState(null);
const [imgMime, setImgMime] = useState(null);
const [history, setHistory] = useState([]);

const videoRef  = useRef(null);
const canvasRef = useRef(null);
const streamRef = useRef(null);
const fileRef   = useRef(null);
const [camOn, setCamOn]   = useState(false);
const [camErr, setCamErr] = useState(“camera_failed”); // default to upload mode in app
const [facing, setFacing] = useState(“environment”);

const startCam = async () => {
setCamErr(””); setCamOn(false);
try {
if (streamRef.current) stopCam();
const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:facing, width:{ideal:1280}, height:{ideal:720} } });
streamRef.current = stream;
if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
setCamOn(true);
} catch { setCamErr(“camera_failed”); }
};
const stopCam = () => {
if (streamRef.current) { streamRef.current.getTracks().forEach(t=>t.stop()); streamRef.current=null; }
if (videoRef.current) videoRef.current.srcObject = null;
setCamOn(false);
};
const flipCam = () => { setFacing(f=>f===“environment”?“user”:“environment”); stopCam(); setTimeout(startCam,200); };
const capture = () => {
const v=videoRef.current, c=canvasRef.current; if(!v||!c) return;
c.width=v.videoWidth; c.height=v.videoHeight; c.getContext(“2d”).drawImage(v,0,0);
const url=c.toDataURL(“image/jpeg”,0.9);
setPreview(url); setImgData(url.split(”,”)[1]); setImgMime(“image/jpeg”);
stopCam(); setResult(null); setError(””);
};
const handleFile = async (file) => {
if (!file) return;
const b64=await fileToBase64(file);
const mime=file.type||“image/jpeg”;
setPreview(`data:${mime};base64,${b64}`);
setImgData(b64); setImgMime(mime);
setResult(null); setError(””); stopCam();
};
const resetImg = () => { setPreview(null); setImgData(null); setImgMime(null); setResult(null); setError(””); stopCam(); };

const scout = async () => {
setLoading(true); setResult(null); setError(””);
try {
let imagePayload = imgData;
if (mode===“camera” && imgData) {
imagePayload = await compressImage(imgData, imgMime);
}
const r = await scoutItem(
mode===“camera” ? imagePayload : input,
mode===“camera”,
“image/jpeg”,
parseFloat(askPrice)||null
);
setResult(r);
setHistory(h=>[{ …r, askPrice: parseFloat(askPrice)||null, scoutedAt: new Date().toISOString() }, …h].slice(0,20));
} catch(e) {
setError(“Couldn’t analyze — “ + (e.message?.includes(“too large”) ? “photo too large, try a smaller one.” : “try describing it with the Type It button instead.”));
}
setLoading(false);
};

const canScout = mode===“camera” ? !!imgData : !!input.trim();

const verdictColor  = (v) => v===“BUY”?”#4ade80”:v===“PASS”?”#f87171”:”#f0c040”;
const verdictBg     = (v) => v===“BUY”?”#4ade8015”:v===“PASS”?”#f8717115”:”#f0c04015”;
const riskColor     = (r) => r===“low”?”#4ade80”:r===“medium”?”#f0c040”:”#f87171”;
const demandColor   = (d) => d===“hot”?”#f97316”:d===“steady”?”#4ade80”:”#94a3b8”;
const demandIcon    = (d) => d===“hot”?“🔥”:d===“steady”?“✅”:“🐢”;
const catG          = (c) => CATEGORIES[c]||CATEGORIES.other;

return (
<div>
{/* Header */}
<div style={{…S.card, background:“linear-gradient(135deg,#1a0a2e,#0a1628)”, borderColor:”#f472b644”}}>
<div style={{fontWeight:800,fontSize:18,marginBottom:4,color:”#f472b6”}}>🤔 Scout Mode</div>
<div style={{fontSize:13,color:”#94a3b8”}}>Snap or describe anything you’re thinking about buying. Get an instant buy/pass verdict with profit estimate.</div>
</div>

```
  {/* Input */}
  <div style={S.card}>
    <div style={{display:"flex",gap:8,marginBottom:16}}>
      {[["camera","📷 Photo"],["text","⌨️ Describe"]].map(([m,lbl])=>(
        <button key={m} onClick={()=>{ setMode(m); resetImg(); setInput(""); setError(""); }} style={{flex:1,padding:"10px",borderRadius:10,border:mode===m?"2px solid #f472b6":"2px solid #ffffff10",background:mode===m?"#f472b615":"#ffffff05",color:mode===m?"#f472b6":"#64748b",fontWeight:700,fontSize:13,cursor:"pointer"}}>{lbl}</button>
      ))}
    </div>

    {/* Asking price — always visible */}
    <div style={{marginBottom:14}}>
      <label style={S.lbl}>Asking Price (optional)</label>
      <div style={{position:"relative"}}>
        <span style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",color:"#64748b",fontSize:14}}>$</span>
        <input style={{...S.inp,paddingLeft:28}} type="number" placeholder="What are they asking?" value={askPrice} onChange={e=>setAsk(e.target.value)}/>
      </div>
    </div>

    {mode==="camera" && (
      <div>
        {preview ? (
          <div style={{position:"relative",marginBottom:12}}>
            <img src={preview} alt="item" style={{width:"100%",borderRadius:12,maxHeight:280,objectFit:"contain",background:"#111"}}/>
            <button onClick={resetImg} style={{position:"absolute",top:8,right:8,background:"#000000aa",border:"none",borderRadius:99,color:"#fff",width:32,height:32,cursor:"pointer",fontSize:16}}>✕</button>
          </div>
        ) : camOn ? (
          <div style={{position:"relative",marginBottom:12}}>
            <video ref={videoRef} style={{width:"100%",borderRadius:12,maxHeight:280,objectFit:"cover",background:"#111",display:"block"}} playsInline muted/>
            <canvas ref={canvasRef} style={{display:"none"}}/>
            <div style={{position:"absolute",bottom:10,left:0,right:0,display:"flex",justifyContent:"center",gap:12}}>
              <button onClick={capture} style={{background:"#fff",border:"4px solid #ffffff88",borderRadius:99,width:60,height:60,cursor:"pointer",fontSize:24}}>📸</button>
              <button onClick={flipCam} style={{background:"#000000aa",border:"none",borderRadius:99,width:44,height:44,cursor:"pointer",color:"#fff",fontSize:20}}>🔄</button>
              <button onClick={stopCam} style={{background:"#ef444488",border:"none",borderRadius:99,width:44,height:44,cursor:"pointer",color:"#fff",fontSize:20}}>✕</button>
            </div>
          </div>
        ) : (
          <div style={{border:`2px dashed ${camErr==="camera_failed"?"#f8717130":"#f472b630"}`,borderRadius:12,padding:28,textAlign:"center",marginBottom:12,background:camErr==="camera_failed"?"#f8717108":"#f472b608"}}>
            {camErr==="camera_failed" ? (
              <>
                <div style={{fontSize:40,marginBottom:8}}>📁</div>
                <div style={{color:"#f87171",fontSize:13,fontWeight:700,marginBottom:4}}>Camera not available in this view</div>
                <div style={{color:"#64748b",fontSize:12,marginBottom:14}}>Upload a photo from your camera roll instead — works just as well!</div>
              </>
            ) : (
              <>
                <div style={{fontSize:44,marginBottom:8}}>🤔</div>
                <div style={{color:"#64748b",fontSize:13,marginBottom:14}}>Point your camera at anything — card, sneaker, gadget, toy</div>
              </>
            )}
            <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
              {camErr!=="camera_failed" && <button style={S.btn("cam")} onClick={startCam}>📷 Open Camera</button>}
              <button style={{...S.btn("primary","#f472b6","#a855f7")}} onClick={()=>fileRef.current?.click()}>📁 Upload Photo</button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
          </div>
        )}
        {preview && (
          <div style={{display:"flex",gap:8,marginBottom:8}}>
            <button style={{...S.btn("ghost"),flex:1}} onClick={()=>{resetImg(); camErr!=="camera_failed" ? startCam() : fileRef.current?.click();}}>🔄 New Photo</button>
            <button style={{...S.btn("ghost"),flex:1}} onClick={()=>fileRef.current?.click()}>📁 From Gallery</button>
            <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
          </div>
        )}
      </div>
    )}

    {mode==="text" && (
      <div style={{marginBottom:12}}>
        <label style={S.lbl}>What is it?</label>
        <textarea style={{...S.inp,minHeight:80,resize:"vertical"}}
          placeholder={"e.g. 'Lot of 20 Pokemon cards including Charizard' or 'Nike Dunk Low Panda size 11' or 'vintage pyrex mixing bowl set'"}
          value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&(e.preventDefault(),canScout&&scout())}
        />
      </div>
    )}

    <button
      style={{...S.btn("primary","#f472b6","#a855f7"),width:"100%",fontSize:15,padding:"13px"}}
      onClick={scout} disabled={loading||!canScout}
    >
      {loading ? "⏳ Analyzing..." : "🤔 Should I Buy This?"}
    </button>
    {error && <div style={{marginTop:10,color:"#f87171",fontSize:13}}>⚠ {error}</div>}
  </div>

  {/* Result */}
  {result && (
    <div>
      {/* Big verdict */}
      <div style={{...S.card, background:verdictBg(result.verdict), border:`2px solid ${verdictColor(result.verdict)}44`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
          <div style={{flex:1}}>
            <div style={{fontSize:13,color:"#94a3b8",marginBottom:4}}>{catG(result.category).icon} {catG(result.category).label}</div>
            <div style={{fontWeight:800,fontSize:18,marginBottom:4,lineHeight:1.3}}>{result.name}</div>
            {result.conditionNotes && <div style={{fontSize:12,color:"#64748b"}}>{result.conditionNotes}</div>}
          </div>
          <div style={{textAlign:"center",flexShrink:0,marginLeft:12}}>
            <div style={{fontSize:32,fontWeight:900,color:verdictColor(result.verdict),lineHeight:1}}>{result.verdict}</div>
            <div style={{fontSize:10,color:"#475569",marginTop:2}}>VERDICT</div>
          </div>
        </div>
        <div style={{background:"#000000aa",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#e2e8f0"}}>
          {result.verdictReason}
        </div>
      </div>

      {/* Price breakdown */}
      <div style={S.card}>
        <div style={{fontWeight:700,marginBottom:12}}>💰 Price Breakdown</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
          {[["Low",result.lowSell,"#f87171"],["Mid",result.midSell,"#f0c040"],["High",result.highSell,"#4ade80"]].map(([l,p,c])=>(
            <div key={l} style={S.pb(c)}>
              <div style={{fontSize:10,color:c,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{l} SELL</div>
              <div style={{fontSize:20,fontWeight:800,color:c}}>${(p||0).toFixed(2)}</div>
            </div>
          ))}
        </div>

        <div style={{background:"#ffffff05",borderRadius:12,padding:14}}>
          {[
            ["Mid sell price",    `$${(result.midSell||0).toFixed(2)}`,  "#e2e8f0"],
            ["Max you should pay",`$${(result.maxPayPrice||0).toFixed(2)}`,"#f0c040"],
            ...(askPrice ? [["They're asking",`$${parseFloat(askPrice).toFixed(2)}`, parseFloat(askPrice)<=(result.maxPayPrice||0)?"#4ade80":"#f87171"]] : []),
            ["eBay fees ~13%",    `-$${((result.midSell||0)*0.13).toFixed(2)}`, "#f87171"],
            ["Est. shipping",     "~$3-15",  "#94a3b8"],
            ["Est. profit",       `${(result.estimatedProfit||0)>=0?"+":""}$${(result.estimatedProfit||0).toFixed(2)}`, (result.estimatedProfit||0)>=0?"#4ade80":"#f87171"],
          ].map(([lbl,val,color])=>(
            <div key={lbl} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",fontSize:13,borderBottom:"1px solid #ffffff08"}}>
              <span style={{color:"#94a3b8"}}>{lbl}</span>
              <span style={{fontWeight:700,color}}>{val}</span>
            </div>
          ))}
        </div>

        {askPrice && (
          <div style={{marginTop:10,padding:"10px 14px",borderRadius:10,background:parseFloat(askPrice)<=(result.maxPayPrice||0)?"#4ade8011":"#f8717111",border:`1px solid ${parseFloat(askPrice)<=(result.maxPayPrice||0)?"#4ade8033":"#f8717133"}`,fontSize:13,fontWeight:700,color:parseFloat(askPrice)<=(result.maxPayPrice||0)?"#4ade80":"#f87171",textAlign:"center"}}>
            {parseFloat(askPrice)<=(result.maxPayPrice||0)
              ? `✅ $${askPrice} is a good price — you have room to profit`
              : `❌ $${askPrice} is too high — max pay is $${(result.maxPayPrice||0).toFixed(2)}`}
          </div>
        )}
      </div>

      {/* Signals */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
        <div style={{...S.card,marginBottom:0,textAlign:"center"}}>
          <div style={{fontSize:24,marginBottom:4}}>{demandIcon(result.demandLevel)}</div>
          <div style={{fontSize:16,fontWeight:800,color:demandColor(result.demandLevel),textTransform:"uppercase"}}>{result.demandLevel}</div>
          <div style={{fontSize:10,color:"#475569",letterSpacing:1}}>DEMAND</div>
        </div>
        <div style={{...S.card,marginBottom:0,textAlign:"center"}}>
          <div style={{fontSize:24,marginBottom:4}}>{result.riskLevel==="low"?"🟢":result.riskLevel==="medium"?"🟡":"🔴"}</div>
          <div style={{fontSize:16,fontWeight:800,color:riskColor(result.riskLevel),textTransform:"uppercase"}}>{result.riskLevel} risk</div>
          <div style={{fontSize:10,color:"#475569",letterSpacing:1}}>RISK LEVEL</div>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
        <div style={{...S.card,marginBottom:0,textAlign:"center"}}>
          <div style={{fontSize:12,color:"#64748b",marginBottom:4}}>TIME TO SELL</div>
          <div style={{fontSize:14,fontWeight:700,color:"#e2e8f0"}}>{result.timeToSell}</div>
        </div>
        <div style={{...S.card,marginBottom:0,textAlign:"center"}}>
          <div style={{fontSize:12,color:"#64748b",marginBottom:4}}>CONFIDENCE</div>
          <div style={{fontSize:14,fontWeight:700,color:result.confidence==="high"?"#4ade80":result.confidence==="medium"?"#f0c040":"#f87171"}}>{result.confidence}</div>
        </div>
      </div>

      {/* Red flags */}
      {result.redFlags?.length > 0 && (
        <div style={{...S.card,borderColor:"#f8717133",background:"#f8717108"}}>
          <div style={{fontWeight:700,color:"#f87171",marginBottom:10}}>🚩 Red Flags</div>
          {result.redFlags.map((flag,i)=>(
            <div key={i} style={{display:"flex",gap:10,padding:"6px 0",fontSize:13,color:"#fca5a5",borderBottom:"1px solid #f8717115"}}>
              <span style={{flexShrink:0}}>⚠</span><span>{flag}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tips */}
      {result.tips?.length > 0 && (
        <div style={S.card}>
          <div style={{fontWeight:700,marginBottom:10}}>💡 Negotiation & Selling Tips</div>
          {result.tips.map((tip,i)=>(
            <div key={i} style={{display:"flex",gap:10,padding:"7px 0",fontSize:13,color:"#94a3b8",borderBottom:"1px solid #ffffff08"}}>
              <span style={{color:"#f472b6",flexShrink:0}}>→</span><span>{tip}</span>
            </div>
          ))}
        </div>
      )}

      {/* Risk reason */}
      {result.riskReason && (
        <div style={{...S.card,borderColor:"#ffffff0a"}}>
          <div style={{fontSize:12,fontWeight:700,color:"#94a3b8",marginBottom:4}}>⚖️ Risk Note</div>
          <div style={{fontSize:13,color:"#64748b"}}>{result.riskReason}</div>
        </div>
      )}
    </div>
  )}

  {/* Scout history */}
  {history.length > 1 && !result && (
    <div style={S.card}>
      <div style={{fontWeight:700,marginBottom:12}}>🕐 Recent Scouts</div>
      {history.slice(0,5).map((h,i)=>(
        <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid #ffffff08"}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{h.name}</div>
            <div style={{fontSize:11,color:"#475569"}}>{h.askPrice?`Asked $${h.askPrice} · `:""}Est. profit ${h.estimatedProfit>=0?"+":""}${(h.estimatedProfit||0).toFixed(0)}</div>
          </div>
          <div style={{fontWeight:800,fontSize:14,color:verdictColor(h.verdict),marginLeft:12,flexShrink:0}}>{h.verdict}</div>
        </div>
      ))}
    </div>
  )}
</div>
```

);
}

// ── List Tab (Photo Checklist + Title Optimizer + Category Finder) ─────────────
function ListTab() {
const [category, setCat]     = useState(“pokemon”);
const [itemName, setItemName]= useState(””);
const [condition, setCond]   = useState(“LP”);
const [brand, setBrand]      = useState(””);
const [set, setSet]          = useState(””);
const [loading, setLoading]  = useState(false);
const [result, setResult]    = useState(null);
const [error, setError]      = useState(””);
const [activeTab, setATab]   = useState(“photos”); // photos | titles | category
const [checked, setChecked]  = useState({});
const [selectedTitle, setST] = useState(””);
const [copied, setCopied]    = useState(””);

const g      = CATEGORIES[category];
const isCard = g.type === “card”;
const conds  = isCard ? CARD_CONDITIONS : ITEM_CONDITIONS;
const photos = getPhotoChecklist(category, itemName);

const optimize = async () => {
if (!itemName.trim()) return;
setLoading(true); setResult(null); setError(””);
try {
const r = await optimizeListing(itemName, category, condition, { brand, set });
setResult(r);
if (r.titles?.[0]) setST(r.titles[0].title);
setATab(“titles”);
} catch { setError(“Couldn’t optimize — try again.”); }
setLoading(false);
};

const copy = (text, key) => {
navigator.clipboard.writeText(text);
setCopied(key);
setTimeout(()=>setCopied(””),2000);
};

const photosDone = Object.values(checked).filter(Boolean).length;

return (
<div>
{/* Item input */}
<div style={S.card}>
<div style={{fontWeight:800,fontSize:17,marginBottom:4}}>📝 Listing Optimizer</div>
<div style={{fontSize:12,color:”#64748b”,marginBottom:16}}>Photo checklist · AI title optimizer · Best eBay category</div>

```
    <label style={S.lbl}>Category</label>
    <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:14}}>
      {Object.entries(CATEGORIES).map(([key,g])=>(
        <button key={key} onClick={()=>{ setCat(key); setResult(null); setChecked({}); }} style={{padding:"8px 4px",borderRadius:10,border:category===key?`2px solid ${g.color}`:"2px solid #ffffff10",background:category===key?g.color+"15":"#ffffff05",color:category===key?g.color:"#64748b",fontWeight:700,fontSize:10,cursor:"pointer",textAlign:"center"}}>
          <div style={{fontSize:16,marginBottom:2}}>{g.icon}</div>
          <div style={{lineHeight:1.1}}>{g.label.split(" ")[0]}</div>
        </button>
      ))}
    </div>

    <label style={S.lbl}>Item Name / Description</label>
    <input style={{...S.inp,marginBottom:12}} placeholder={isCard?"e.g. Charizard GX Full Art Rainbow Rare":"e.g. Nike Air Jordan 1 Retro High OG Chicago"} value={itemName} onChange={e=>setItemName(e.target.value)}/>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
      <div>
        <label style={S.lbl}>Condition</label>
        <select style={S.inp} value={condition} onChange={e=>setCond(e.target.value)}>
          {conds.map(c=><option key={c} value={c}>{CONDITION_MAP[c]}</option>)}
        </select>
      </div>
      {isCard ? (
        <div>
          <label style={S.lbl}>Set / Series</label>
          <input style={S.inp} placeholder="e.g. Burning Shadows" value={set} onChange={e=>setSet(e.target.value)}/>
        </div>
      ) : (
        <div>
          <label style={S.lbl}>Brand</label>
          <input style={S.inp} placeholder="e.g. Nike, Apple, Sony" value={brand} onChange={e=>setBrand(e.target.value)}/>
        </div>
      )}
    </div>

    <button style={{...S.btn("primary",g.color,g.accent),width:"100%"}} onClick={optimize} disabled={loading||!itemName.trim()}>
      {loading?"⏳ Optimizing listing...":"✨ Optimize My Listing"}
    </button>
    {error && <div style={{marginTop:10,color:"#f87171",fontSize:13}}>⚠ {error}</div>}
  </div>

  {/* Sub-tabs */}
  <div style={{display:"flex",gap:0,marginBottom:16,background:"#0f0f1a",borderRadius:12,padding:4,border:"1px solid #ffffff0f"}}>
    {[["photos",`📷 Photos (${photosDone}/${photos.length})`],["titles","✍️ Titles"],["category","🗂 Category"]].map(([t,lbl])=>(
      <button key={t} onClick={()=>setATab(t)} style={{flex:1,padding:"9px 8px",borderRadius:9,border:"none",fontWeight:700,fontSize:12,cursor:"pointer",background:activeTab===t?"#ffffff12":"none",color:activeTab===t?"#e2e8f0":"#64748b",transition:"all 0.2s"}}>{lbl}</button>
    ))}
  </div>

  {/* ── PHOTOS TAB ── */}
  {activeTab==="photos" && (
    <div style={S.card}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div>
          <div style={{fontWeight:700,fontSize:15}}>📷 Photo Checklist</div>
          <div style={{fontSize:12,color:"#64748b",marginTop:2}}>For {g.label}{itemName?` — ${itemName.slice(0,30)}`:""}</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:22,fontWeight:800,color:photosDone===photos.length?"#4ade80":"#f0c040"}}>{photosDone}/{photos.length}</div>
          <div style={{fontSize:10,color:"#475569"}}>DONE</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{background:"#ffffff10",borderRadius:99,height:6,marginBottom:16,overflow:"hidden"}}>
        <div style={{background:`linear-gradient(90deg,${g.color},${g.accent})`,height:"100%",borderRadius:99,width:`${photos.length>0?(photosDone/photos.length)*100:0}%`,transition:"width 0.4s"}}/>
      </div>

      {photos.map((shot,i)=>{
        const done = !!checked[i];
        return (
          <div key={i} onClick={()=>setChecked(p=>({...p,[i]:!p[i]}))} style={{display:"flex",alignItems:"flex-start",gap:12,padding:"12px 0",borderBottom:"1px solid #ffffff08",cursor:"pointer"}}>
            <div style={{width:24,height:24,borderRadius:7,border:`2px solid ${done?g.color:"#ffffff20"}`,background:done?g.color+"33":"none",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>
              {done && <span style={{color:g.color,fontSize:14}}>✓</span>}
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:done?"#64748b":"#e2e8f0",textDecoration:done?"line-through":"none"}}>{shot}</div>
            </div>
          </div>
        );
      })}

      {photosDone===photos.length && photos.length>0 && (
        <div style={{marginTop:14,background:"#4ade8011",border:"1px solid #4ade8033",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#4ade80",textAlign:"center"}}>
          ✅ All photos done! Ready to list.
        </div>
      )}

      <div style={{marginTop:14,background:"#ffffff08",borderRadius:10,padding:"10px 14px"}}>
        <div style={{fontSize:12,fontWeight:700,color:"#94a3b8",marginBottom:6}}>💡 Pro Tips for {g.label}</div>
        <div style={{fontSize:12,color:"#64748b",lineHeight:1.7}}>
          {isCard
            ? "• Natural light or a lightbox — no flash (causes glare on holos)\n• White or gray background\n• Multiple angles if any damage\n• Show the card number & set symbol clearly"
            : category==="sneakers"
            ? "• Clean shoes before photographing\n• White background boosts clicks\n• Show both shoes side by side\n• Include all tags & original box if you have it"
            : category==="electronics"
            ? "• Power it on to show it works\n• Photograph all ports & buttons\n• Include serial number shot for buyer trust\n• Show accessories & original packaging if available"
            : "• Good natural lighting is everything\n• Show any flaws honestly — fewer returns\n• Include something for scale\n• Multiple angles builds buyer confidence"
          }
        </div>
      </div>
    </div>
  )}

  {/* ── TITLES TAB ── */}
  {activeTab==="titles" && (
    <div>
      {!result ? (
        <div style={{...S.card,textAlign:"center",padding:40}}>
          <div style={{fontSize:40,marginBottom:12}}>✍️</div>
          <div style={{color:"#64748b",marginBottom:12}}>Enter item details above and tap "Optimize My Listing" to get AI-powered title suggestions</div>
          <button style={{...S.btn("primary",g.color,g.accent)}} onClick={optimize} disabled={loading||!itemName.trim()}>{loading?"⏳ Optimizing...":"✨ Optimize Now"}</button>
        </div>
      ) : (
        <>
          {/* Title options */}
          <div style={S.card}>
            <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>✍️ Title Options</div>
            <div style={{fontSize:12,color:"#64748b",marginBottom:14}}>Tap to select, then copy to eBay</div>
            {result.titles?.map((t,i)=>{
              const isSel = selectedTitle===t.title;
              return (
                <div key={i} onClick={()=>setST(t.title)} style={{padding:14,borderRadius:12,marginBottom:10,border:isSel?`2px solid ${g.color}`:`1px solid #ffffff10`,background:isSel?g.color+"0d":"#ffffff05",cursor:"pointer",transition:"all 0.15s"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:6}}>
                    <div style={{fontSize:13,fontWeight:700,color:isSel?g.color:"#e2e8f0",lineHeight:1.4,flex:1}}>{t.title}</div>
                    <div style={{flexShrink:0,textAlign:"center"}}>
                      <div style={{fontSize:16,fontWeight:800,color:t.score>=90?"#4ade80":t.score>=80?"#f0c040":"#f87171"}}>{t.score}</div>
                      <div style={{fontSize:9,color:"#475569"}}>SCORE</div>
                    </div>
                  </div>
                  <div style={{fontSize:11,color:"#64748b"}}>{t.reason}</div>
                  <div style={{fontSize:10,color:t.title.length>80?"#f87171":"#475569",marginTop:4}}>{t.title.length}/80 chars</div>
                </div>
              );
            })}
            {selectedTitle && (
              <button style={{...S.btn("primary",g.color,g.accent),width:"100%",marginTop:4}} onClick={()=>copy(selectedTitle,"title")}>
                {copied==="title"?"✓ Copied!":"📋 Copy Selected Title"}
              </button>
            )}
          </div>

          {/* Keywords */}
          {result.keywords?.length > 0 && (
            <div style={S.card}>
              <div style={{fontWeight:700,marginBottom:10}}>🔍 Search Keywords</div>
              <div style={{fontSize:12,color:"#64748b",marginBottom:10}}>Include these in your title or description for better search visibility</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {result.keywords.map((kw,i)=>(
                  <span key={i} onClick={()=>copy(kw,`kw${i}`)} style={{background:g.color+"15",color:g.color,border:`1px solid ${g.color}33`,borderRadius:99,padding:"5px 12px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                    {copied===`kw${i}`?"✓":""} {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Title tips */}
          {result.titleTips?.length > 0 && (
            <div style={S.card}>
              <div style={{fontWeight:700,marginBottom:10}}>💡 Title Tips for This Item</div>
              {result.titleTips.map((tip,i)=>(
                <div key={i} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:"1px solid #ffffff08",fontSize:13,color:"#94a3b8"}}>
                  <span style={{color:g.color,flexShrink:0}}>→</span>
                  <span>{tip}</span>
                </div>
              ))}
            </div>
          )}

          {/* Pricing tip */}
          {result.pricingTip && (
            <div style={{...S.card,borderColor:g.color+"33",background:g.color+"08"}}>
              <div style={{fontSize:12,fontWeight:700,color:g.color,marginBottom:4}}>💰 Pricing Insight</div>
              <div style={{fontSize:13,color:"#94a3b8"}}>{result.pricingTip}</div>
            </div>
          )}
        </>
      )}
    </div>
  )}

  {/* ── CATEGORY TAB ── */}
  {activeTab==="category" && (
    <div>
      {!result ? (
        <div style={{...S.card,textAlign:"center",padding:40}}>
          <div style={{fontSize:40,marginBottom:12}}>🗂</div>
          <div style={{color:"#64748b",marginBottom:12}}>Enter item details above and tap "Optimize My Listing" to find the best eBay categories</div>
          <button style={{...S.btn("primary",g.color,g.accent)}} onClick={optimize} disabled={loading||!itemName.trim()}>{loading?"⏳ Optimizing...":"✨ Find Categories"}</button>
        </div>
      ) : (
        <>
          <div style={S.card}>
            <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>🗂 Best eBay Categories</div>
            <div style={{fontSize:12,color:"#64748b",marginBottom:14}}>Use these category IDs when listing on eBay</div>
            {result.categories?.map((cat,i)=>(
              <div key={i} style={{padding:14,borderRadius:12,marginBottom:10,border:`1px solid ${i===0?g.color+"44":"#ffffff10"}`,background:i===0?g.color+"08":"#ffffff05"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <div style={{fontWeight:700,fontSize:14,color:i===0?g.color:"#e2e8f0"}}>{cat.name}</div>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    {i===0 && <span style={{fontSize:10,background:g.color+"22",color:g.color,border:`1px solid ${g.color}44`,borderRadius:99,padding:"2px 8px",fontWeight:700}}>BEST MATCH</span>}
                    <Pill label={cat.confidence} color={cat.confidence==="high"?"#4ade80":cat.confidence==="medium"?"#f0c040":"#94a3b8"}/>
                  </div>
                </div>
                <div style={{fontSize:12,color:"#64748b",marginBottom:8}}>{cat.reason}</div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <span style={{fontSize:11,color:"#475569"}}>Category ID:</span>
                  <code style={{fontSize:12,background:"#ffffff10",padding:"2px 8px",borderRadius:6,color:"#e2e8f0"}}>{cat.id}</code>
                  <button onClick={()=>copy(cat.id,`cat${i}`)} style={{...S.btn("ghost"),fontSize:11,padding:"4px 10px"}}>{copied===`cat${i}`?"✓":"Copy"}</button>
                </div>
              </div>
            ))}
          </div>

          {/* Item Specifics */}
          {result.itemSpecifics && Object.keys(result.itemSpecifics).length > 0 && (
            <div style={S.card}>
              <div style={{fontWeight:700,marginBottom:10}}>📋 Suggested Item Specifics</div>
              <div style={{fontSize:12,color:"#64748b",marginBottom:12}}>Fill these in on eBay to boost search ranking significantly</div>
              {Object.entries(result.itemSpecifics).filter(([,v])=>v).map(([k,v])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #ffffff08"}}>
                  <span style={{fontSize:13,color:"#64748b"}}>{k}</span>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <span style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{v}</span>
                    <button onClick={()=>copy(v,`spec${k}`)} style={{...S.btn("ghost"),fontSize:10,padding:"3px 8px"}}>{copied===`spec${k}`?"✓":"Copy"}</button>
                  </div>
                </div>
              ))}
              <div style={{marginTop:12,fontSize:11,color:"#475569"}}>💡 eBay listings with complete item specifics get up to 20% more views</div>
            </div>
          )}
        </>
      )}
    </div>
  )}
</div>
```

);
}

// ── Shipping Tab ──────────────────────────────────────────────────────────────
function ShippingTab() {
const [category, setCat]     = useState(“pokemon”);
const [itemName, setItemName]= useState(””);
const [weightOz, setWeight]  = useState(””);
const [l, setL]              = useState(””);
const [w, setW]              = useState(””);
const [h, setH]              = useState(””);
const [sellPrice, setSell]   = useState(””);
const [buyPrice, setBuy]     = useState(””);
const [loading, setLoading]  = useState(false);
const [result, setResult]    = useState(null);
const [mode, setMode]        = useState(“auto”); // “auto” | “manual”

const g = CATEGORIES[category];
const preset = SHIP_PRESETS[category];

const autoEstimate = async () => {
if (!itemName.trim()) return;
setLoading(true); setResult(null);
try {
const est = await estimateShipping(itemName, category);
setWeight(String(est.weightOz));
setL(String(est.l)); setW(String(est.w)); setH(String(est.h));
const rates = calcShipping(est.weightOz, est.l, est.w, est.h);
setResult({ …rates, packageType: est.packageType, notes: est.notes, weightOz: est.weightOz, l: est.l, w: est.w, h: est.h });
} catch { }
setLoading(false);
};

const manualCalc = () => {
const oz = parseFloat(weightOz)||preset.weightOz;
const dl = parseFloat(l)||preset.l;
const dw = parseFloat(w)||preset.w;
const dh = parseFloat(h)||preset.h;
const rates = calcShipping(oz, dl, dw, dh);
setResult({ …rates, weightOz: oz, l: dl, w: dw, h: dh });
};

const sp = parseFloat(sellPrice)||0;
const bp = parseFloat(buyPrice)||0;
const shipCost = result ? result.recommended.cost : 0;
const ebayFee  = sp * 0.13;
const netProfit = sp - bp - shipCost - ebayFee;
const pc = netProfit >= 0 ? “#4ade80” : “#f87171”;

return (
<div>
<div style={S.card}>
<div style={{fontWeight:800,fontSize:17,marginBottom:4}}>🚚 Shipping Calculator</div>
<div style={{fontSize:12,color:”#64748b”,marginBottom:16}}>Estimate USPS & UPS rates + real profit after all costs</div>

```
    <label style={S.lbl}>Item Category</label>
    <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:16}}>
      {Object.entries(CATEGORIES).map(([key,g])=>(
        <button key={key} onClick={()=>{ setCat(key); setResult(null); }} style={{padding:"8px 4px",borderRadius:10,border:category===key?`2px solid ${g.color}`:"2px solid #ffffff10",background:category===key?g.color+"15":"#ffffff05",color:category===key?g.color:"#64748b",fontWeight:700,fontSize:10,cursor:"pointer",textAlign:"center"}}>
          <div style={{fontSize:16,marginBottom:2}}>{g.icon}</div>
          <div style={{lineHeight:1.1}}>{g.label.split(" ")[0]}</div>
        </button>
      ))}
    </div>

    <div style={{display:"flex",gap:8,marginBottom:16}}>
      {[["auto","🤖 AI Estimate"],["manual","📏 Enter Manually"]].map(([m,lbl])=>(
        <button key={m} onClick={()=>{ setMode(m); setResult(null); }} style={{flex:1,padding:"10px",borderRadius:10,border:mode===m?`2px solid ${g.color}`:"2px solid #ffffff10",background:mode===m?g.color+"15":"#ffffff05",color:mode===m?g.color:"#64748b",fontWeight:700,fontSize:12,cursor:"pointer"}}>{lbl}</button>
      ))}
    </div>

    {mode==="auto" && (
      <div>
        <label style={S.lbl}>What are you shipping?</label>
        <input style={{...S.inp, marginBottom:12}} placeholder="e.g. 'Nike Air Jordan 1 size 10' or 'iPhone 13 Pro'" value={itemName} onChange={e=>setItemName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&autoEstimate()}/>
        <button style={{...S.btn("primary",g.color,g.accent),width:"100%"}} onClick={autoEstimate} disabled={loading}>
          {loading?"⏳ Estimating...":"🤖 AI Estimate Package & Rates"}
        </button>
        <div style={{fontSize:11,color:"#475569",marginTop:8}}>AI picks the right box size and weight for this type of item</div>
      </div>
    )}

    {mode==="manual" && (
      <div>
        <div style={{background:"#ffffff08",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#94a3b8"}}>
          📦 Suggested for {g.label}: <strong style={{color:"#e2e8f0"}}>{preset.name}</strong> · {preset.weightOz}oz · {preset.l}×{preset.w}×{preset.h}"
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <div>
            <label style={S.lbl}>Weight (oz)</label>
            <input style={S.inp} type="number" placeholder={String(preset.weightOz)} value={weightOz} onChange={e=>setWeight(e.target.value)}/>
          </div>
          <div>
            <label style={S.lbl}>Length (in)</label>
            <input style={S.inp} type="number" placeholder={String(preset.l)} value={l} onChange={e=>setL(e.target.value)}/>
          </div>
          <div>
            <label style={S.lbl}>Width (in)</label>
            <input style={S.inp} type="number" placeholder={String(preset.w)} value={w} onChange={e=>setW(e.target.value)}/>
          </div>
          <div>
            <label style={S.lbl}>Height (in)</label>
            <input style={S.inp} type="number" placeholder={String(preset.h)} value={h} onChange={e=>setH(e.target.value)}/>
          </div>
        </div>
        <button style={{...S.btn("primary",g.color,g.accent),width:"100%"}} onClick={manualCalc}>📏 Calculate Rates</button>
      </div>
    )}
  </div>

  {result && (
    <>
      {/* Package summary */}
      {result.packageType && (
        <div style={{...S.card,borderColor:g.color+"33"}}>
          <div style={{fontWeight:700,marginBottom:8}}>📦 Package Details</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
            {[["Type",result.packageType||"Box"],["Weight",`${result.weightOz}oz`],["Size",`${result.l}×${result.w}×${result.h}"`],["Notes",result.notes||"—"]].map(([lbl,val])=>(
              <div key={lbl} style={{background:"#ffffff08",borderRadius:8,padding:"8px 10px",textAlign:"center"}}>
                <div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{lbl}</div>
                <div style={{fontSize:12,fontWeight:700,color:"#e2e8f0",lineHeight:1.3}}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rate cards */}
      <div style={S.card}>
        <div style={{fontWeight:700,marginBottom:12}}>📬 Shipping Rates</div>
        {[result.usps, result.ups].map((r,i)=>{
          const isRec = r.service === result.recommended.service;
          return (
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",borderRadius:12,marginBottom:8,border:isRec?"1px solid #22c55e44":"1px solid #ffffff10",background:isRec?"#22c55e0a":"#ffffff05"}}>
              <div>
                <div style={{fontWeight:700,fontSize:14,color:isRec?"#22c55e":"#e2e8f0"}}>{r.service} {isRec&&"⭐"}</div>
                <div style={{fontSize:11,color:"#64748b"}}>{r.days} business days</div>
              </div>
              <div style={{fontSize:22,fontWeight:800,color:isRec?"#22c55e":"#e2e8f0"}}>${r.cost.toFixed(2)}</div>
            </div>
          );
        })}
        <div style={{fontSize:11,color:"#475569",marginTop:4}}>Rates are estimates. Final cost depends on destination zip code.</div>
      </div>

      {/* Profit calculator */}
      <div style={S.card}>
        <div style={{fontWeight:700,marginBottom:12}}>💰 Full Profit Calculator</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <div>
            <label style={S.lbl}>Sale Price ($)</label>
            <input style={S.inp} type="number" placeholder="0.00" value={sellPrice} onChange={e=>setSell(e.target.value)}/>
          </div>
          <div>
            <label style={S.lbl}>Buy / Cost Price ($)</label>
            <input style={S.inp} type="number" placeholder="0.00" value={buyPrice} onChange={e=>setBuy(e.target.value)}/>
          </div>
        </div>

        {(sp > 0 || bp > 0) && (
          <div style={{background:"#ffffff05",borderRadius:12,padding:14}}>
            {[
              ["Sale Price",       `$${sp.toFixed(2)}`,         "#e2e8f0"],
              ["− Cost / Buy",     `-$${bp.toFixed(2)}`,        "#f87171"],
              ["− Shipping (rec)", `-$${shipCost.toFixed(2)}`,  "#f87171"],
              ["− eBay Fees 13%",  `-$${ebayFee.toFixed(2)}`,   "#f87171"],
            ].map(([lbl,val,color])=>(
              <div key={lbl} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:13,borderBottom:"1px solid #ffffff08"}}>
                <span style={{color:"#94a3b8"}}>{lbl}</span>
                <span style={{color,fontWeight:600}}>{val}</span>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0 0",fontSize:16,fontWeight:800}}>
              <span style={{color:"#e2e8f0"}}>Net Profit</span>
              <span style={{color:pc}}>{netProfit>=0?"+":""}${netProfit.toFixed(2)}</span>
            </div>
            {sp > 0 && <div style={{fontSize:11,color:"#475569",marginTop:6,textAlign:"right"}}>Margin: {((netProfit/sp)*100).toFixed(1)}%</div>}
          </div>
        )}

        <div style={{marginTop:12,background:"#ffffff08",borderRadius:10,padding:"10px 14px"}}>
          <div style={{fontSize:12,fontWeight:700,marginBottom:6,color:"#94a3b8"}}>💡 Shipping Tips for {g.label}</div>
          <div style={{fontSize:12,color:"#64748b",lineHeight:1.6}}>
            {category==="pokemon"||category==="yugioh"||category==="magic"||category==="onepiece"
              ? "Single cards: Use a PWE with top loader ($0.68 stamp). 2-5 cards: bubble mailer. Lots: small priority box. Offer free shipping on $15+ cards to boost search ranking."
              : category==="sneakers"
              ? "Ship in original box when possible — adds value. Double-box for protection. UPS is usually cheaper for heavy shoe boxes over 3lbs."
              : category==="electronics"
              ? "Bubble wrap all electronics. Include original accessories if you have them. Insure items over $100. Take photos before packing."
              : category==="clothing"
              ? "Poly mailers work for most clothing. Use Priority for anything buyers might want fast. Fold neatly — presentation matters for feedback."
              : "Photograph item next to a ruler before shipping. Keep tracking numbers. Pack securely to avoid damage claims."}
          </div>
        </div>
      </div>
    </>
  )}
</div>
```

);
}

// ── eBay Tab ──────────────────────────────────────────────────────────────────
function EbayTab({ flips, settings, onSaveSettings }) {
const [s,setS]           = useState(settings);
const [selected,setSel]  = useState({});
const [generating,setGen]= useState(false);
const [progress,setProg] = useState(””);
const [done,setDone]     = useState(false);
const [showApi,setShowApi]= useState(false);
const [apiKey,setApiKey] = useState(””);

useEffect(()=>setS(settings),[settings]);

const toggleAll=()=>{ if(Object.keys(selected).length===flips.length)setSel({}); else{const s={};flips.forEach(f=>s[f.id]=true);setSel(s);} };
const toggle=(id)=>setSel(p=>{const n={…p};n[id]?delete n[id]:n[id]=true;return n;});
const selectedFlips=flips.filter(f=>selected[f.id]);
const price=(flip)=>((flip.midPrice||0)*(1+(s.markup||10)/100));

const exportCSV=async()=>{
if(!selectedFlips.length)return;
setGen(true);setDone(false);
const rows=[];
for(let i=0;i<selectedFlips.length;i++){
const flip=selectedFlips[i];
setProg(`Generating description ${i+1}/${selectedFlips.length}: ${flip.name}`);
try {
const desc=await genDescription(flip.name,flip.condition,flip.category,{brand:flip.brand,set:flip.set});
rows.push(buildRow(flip,desc,s));
} catch {
rows.push(buildRow(flip,`${flip.name} in ${CONDITION_MAP[flip.condition]||flip.condition} condition. Ships within 1 business day.`,s));
}
}
downloadCSV(rows); setProg(””);setDone(true);setGen(false);
};

return (
<div>
<div style={{…S.card,borderColor:”#e5323844”,background:”#e5323808”}}>
<div style={{display:“flex”,alignItems:“center”,gap:12,marginBottom:8}}>
<span style={{fontSize:24}}>🛒</span>
<div>
<div style={{fontWeight:800,fontSize:15,color:”#e53238”}}>eBay Direct Listing</div>
<div style={{fontSize:12,color:”#64748b”}}>One-tap listing when your API key arrives</div>
</div>
<span style={{marginLeft:“auto”,fontSize:11,background:”#f5af0222”,color:”#f5af02”,border:“1px solid #f5af0244”,borderRadius:99,padding:“3px 10px”,fontWeight:700}}>PENDING API</span>
</div>
<div style={{fontSize:13,color:”#94a3b8”,marginBottom:12}}>Paste your eBay Developer API key below when it arrives and listings will go live with one tap.</div>
<button style={{…S.btn(“ghost”),fontSize:12}} onClick={()=>setShowApi(!showApi)}>{showApi?“▲ Hide”:“▼ Enter API Key when ready”}</button>
{showApi && (
<div style={{marginTop:12}}>
<label style={S.lbl}>eBay App ID (Client ID)</label>
<div style={{display:“flex”,gap:8}}>
<input style={{…S.inp,flex:1}} type=“password” placeholder=“YourApp-XXXX-…” value={apiKey} onChange={e=>setApiKey(e.target.value)}/>
<button style={S.btn(“ebay”)} onClick={()=>{onSaveSettings({…s,apiKey});alert(“Saved! Direct listing will activate once we wire up the full API flow.”);}}>Save</button>
</div>
</div>
)}
</div>

```
  <div style={S.card}>
    <div style={{fontWeight:700,marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <span>⚙️ Listing Settings</span>
      <button style={{...S.btn("primary"),fontSize:11,padding:"6px 14px"}} onClick={()=>onSaveSettings(s)}>Save</button>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
      {[["shippingPolicy","Shipping Profile"],["returnPolicy","Return Profile"],["paymentPolicy","Payment Profile"],["location","Location"]].map(([k,lbl])=>(
        <div key={k}>
          <label style={S.lbl}>{lbl}</label>
          <input style={S.inp} placeholder={k==="location"?"e.g. Los Angeles, CA":""} value={s[k]||""} onChange={e=>setS({...s,[k]:e.target.value})}/>
        </div>
      ))}
    </div>
    <div style={{marginTop:12}}>
      <label style={S.lbl}>Markup % above mid market price</label>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <input style={{...S.inp,flex:1}} type="number" min="0" max="200" value={s.markup||10} onChange={e=>setS({...s,markup:parseFloat(e.target.value)||0})}/>
        <span style={{color:"#94a3b8",fontSize:13,whiteSpace:"nowrap"}}>+{s.markup||10}%</span>
      </div>
    </div>
  </div>

  <div style={S.card}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
      <div style={{fontWeight:700}}>Select Items to Export</div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <span style={{fontSize:12,color:"#64748b"}}>{Object.keys(selected).length}/{flips.length} selected</span>
        <button style={{...S.btn("ghost"),fontSize:11,padding:"6px 12px"}} onClick={toggleAll}>{Object.keys(selected).length===flips.length?"Deselect All":"Select All"}</button>
      </div>
    </div>
    {flips.length===0 ? (
      <div style={{textAlign:"center",padding:24,color:"#64748b"}}>No active items yet — scan something first!</div>
    ) : (
      <div style={{maxHeight:320,overflowY:"auto"}}>
        {flips.map(flip=>{
          const g=CATEGORIES[flip.category]||CATEGORIES.other;
          const isSel=!!selected[flip.id];
          return (
            <div key={flip.id} onClick={()=>toggle(flip.id)} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid #ffffff08",cursor:"pointer",opacity:isSel?1:0.6,transition:"opacity 0.15s"}}>
              <div style={{width:20,height:20,borderRadius:6,border:`2px solid ${isSel?g.color:"#ffffff20"}`,background:isSel?g.color+"33":"none",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {isSel && <span style={{color:g.color,fontSize:12}}>✓</span>}
              </div>
              <span style={{fontSize:16}}>{g.icon}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{flip.name}</div>
                <div style={{fontSize:11,color:"#64748b"}}>{flip.condition} · {g.label}</div>
              </div>
              <div style={{fontSize:13,fontWeight:700,color:"#4ade80",whiteSpace:"nowrap"}}>${price(flip).toFixed(2)}</div>
            </div>
          );
        })}
      </div>
    )}
  </div>

  {selectedFlips.length>0 && (
    <div style={S.card}>
      <div style={{fontWeight:700,marginBottom:8}}>Export {selectedFlips.length} item{selectedFlips.length!==1?"s":""} to eBay CSV</div>
      <div style={{fontSize:12,color:"#64748b",marginBottom:14}}>
        AI writes a description for each item then downloads a CSV.<br/>
        Upload at: <span style={{color:"#60a5fa"}}>eBay Seller Hub → Listings → Add listings with file</span>
      </div>
      {progress && <div style={{background:"#ffffff08",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#94a3b8"}}>⏳ {progress}</div>}
      {done && <div style={{background:"#4ade8011",border:"1px solid #4ade8033",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:13,color:"#4ade80"}}>✓ CSV downloaded! Upload it in eBay Seller Hub.</div>}
      <button style={{...S.btn("ebay"),width:"100%",fontSize:15,padding:"14px"}} onClick={exportCSV} disabled={generating}>
        {generating?"⏳ Generating descriptions...":`🛒 Download eBay CSV (${selectedFlips.length} items)`}
      </button>
      <div style={{marginTop:10,fontSize:11,color:"#475569"}}>AI writes a professional description for each item (~5 sec each).</div>
    </div>
  )}
</div>
```

);
}

// ── Budget Tab ────────────────────────────────────────────────────────────────
function BudgetTab({ budget, onSave, invested, profit, flips }) {
const [input,setInput]=useState(String(budget||””));
const remaining=budget-invested;
const soldFlips=flips.filter(f=>f.status===“sold”);
const roi=invested>0?((profit/invested)*100).toFixed(1):0;
const avg=soldFlips.length>0?(profit/soldFlips.length).toFixed(2):0;
const breakdown=Object.entries(CATEGORIES).map(([key,g])=>{
const gf=flips.filter(f=>f.category===key);
const gp=gf.filter(f=>f.status===“sold”).reduce((s,f)=>s+((f.sellPrice||0)-(f.buyPrice||0)),0);
return {key,g,profit:gp,active:gf.filter(f=>f.status!==“sold”).length,total:gf.length};
}).filter(x=>x.total>0);

return (
<div>
<div style={S.card}>
<label style={S.lbl}>Flip Budget</label>
<div style={{display:“flex”,gap:10}}>
<input style={{…S.inp,flex:1}} type=“number” value={input} onChange={e=>setInput(e.target.value)} placeholder=“500”/>
<button style={S.btn(“primary”)} onClick={()=>onSave(parseFloat(input)||0)}>Save</button>
</div>
</div>
<div style={{display:“grid”,gridTemplateColumns:“1fr 1fr”,gap:12,marginBottom:16}}>
{[[“Budget”,`$${budget.toFixed(0)}`,”#60a5fa”],[“Invested”,`$${invested.toFixed(0)}`,”#f0c040”],[“Remaining”,`$${remaining.toFixed(0)}`,remaining>=0?”#4ade80”:”#f87171”],[“Total Profit”,`${profit>=0?"+":""}$${Math.abs(profit).toFixed(0)}`,profit>=0?”#4ade80”:”#f87171”],[“ROI”,`${roi}%`,parseFloat(roi)>=0?”#4ade80”:”#f87171”],[“Avg/Flip”,`$${avg}`,”#94a3b8”]].map(([l,v,c])=>(
<div key={l} style={{…S.card,textAlign:“center”,padding:16,marginBottom:0}}>
<div style={{fontSize:22,fontWeight:800,color:c}}>{v}</div>
<div style={{fontSize:11,color:”#475569”,textTransform:“uppercase”,letterSpacing:1,marginTop:4}}>{l}</div>
</div>
))}
</div>
{breakdown.length>0 && (
<div style={S.card}>
<div style={{fontWeight:700,marginBottom:12}}>Profit by Category</div>
{breakdown.map(({key,g,profit:gp,active})=>(
<div key={key} style={{display:“flex”,justifyContent:“space-between”,alignItems:“center”,padding:“10px 0”,borderBottom:“1px solid #ffffff08”}}>
<div style={{display:“flex”,alignItems:“center”,gap:10}}>
<span style={{fontSize:20}}>{g.icon}</span>
<div>
<div style={{fontSize:13,fontWeight:700,color:g.color}}>{g.label}</div>
<div style={{fontSize:11,color:”#475569”}}>{active} active</div>
</div>
</div>
<div style={{fontWeight:700,color:gp>=0?”#4ade80”:”#f87171”}}>{gp>=0?”+”:””}${gp.toFixed(2)}</div>
</div>
))}
</div>
)}
<div style={S.card}>
<div style={{fontWeight:700,marginBottom:12}}>Recent Sold</div>
{soldFlips.slice(0,8).map(f=>{
const p=(f.sellPrice||0)-(f.buyPrice||0);
const g=CATEGORIES[f.category]||CATEGORIES.other;
return (
<div key={f.id} style={{display:“flex”,justifyContent:“space-between”,alignItems:“center”,padding:“8px 0”,borderBottom:“1px solid #ffffff08”,fontSize:13}}>
<div style={{display:“flex”,alignItems:“center”,gap:8,flex:1,minWidth:0}}>
<span>{g.icon}</span>
<span style={{color:”#94a3b8”,overflow:“hidden”,textOverflow:“ellipsis”,whiteSpace:“nowrap”}}>{f.name}</span>
</div>
<span style={{color:p>=0?”#4ade80”:”#f87171”,fontWeight:700,whiteSpace:“nowrap”,marginLeft:12}}>{p>=0?”+”:””}${p.toFixed(2)}</span>
</div>
);
})}
{soldFlips.length===0 && <div style={{color:”#475569”,fontSize:13}}>No sales yet — start flipping!</div>}
</div>
</div>
);
}

// ── Spending Tab ──────────────────────────────────────────────────────────────
const SPEND_CATS = [
{ key:“inventory”, label:“Inventory”,  icon:“📦”, color:”#f0c040” },
{ key:“supplies”,  label:“Supplies”,   icon:“🛒”, color:”#06b6d4” },
{ key:“shipping”,  label:“Shipping”,   icon:“🚚”, color:”#22c55e” },
{ key:“fees”,      label:“eBay Fees”,  icon:“🏷”, color:”#a855f7” },
{ key:“tools”,     label:“Tools/Apps”, icon:“🔧”, color:”#f97316” },
{ key:“travel”,    label:“Travel”,     icon:“🚗”, color:”#ec4899” },
{ key:“other”,     label:“Other”,      icon:“💳”, color:”#94a3b8” },
];

function SpendingTab({ spending, onSave, flips }) {
const [showAdd, setShowAdd]     = useState(false);
const [desc, setDesc]           = useState(””);
const [amount, setAmount]       = useState(””);
const [cat, setCat]             = useState(“inventory”);
const [date, setDate]           = useState(new Date().toISOString().slice(0,10));
const [filterCat, setFilterCat] = useState(“all”);
const [filterPeriod, setPeriod] = useState(“month”);

// Auto-include buy prices from flips as inventory spend
const flipSpend = flips.map(f=>({
id:“flip_”+f.id, desc:f.name, amount:f.buyPrice||0,
cat:“inventory”, date:(f.addedAt||new Date().toISOString()).slice(0,10), fromFlip:true,
}));

const allSpend = […spending, …flipSpend];

const now = new Date();
const filterDate = (item) => {
const d = new Date(item.date);
if (filterPeriod===“week”)  return (now-d)<=7*86400000;
if (filterPeriod===“month”) return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
if (filterPeriod===“year”)  return d.getFullYear()===now.getFullYear();
return true;
};

const filtered = allSpend.filter(filterDate).filter(s=>filterCat===“all”||s.cat===filterCat).sort((a,b)=>new Date(b.date)-new Date(a.date));
const totalSpend   = allSpend.filter(filterDate).reduce((s,x)=>s+(x.amount||0),0);
const totalRevenue = flips.filter(f=>f.status===“sold”).reduce((s,f)=>s+(f.sellPrice||0),0);
const netProfit    = totalRevenue - totalSpend;

const catBreakdown = SPEND_CATS.map(sc=>{
const items = allSpend.filter(filterDate).filter(s=>s.cat===sc.key);
const total = items.reduce((s,x)=>s+(x.amount||0),0);
const pct   = totalSpend>0?(total/totalSpend*100).toFixed(0):0;
return {…sc, total, count:items.length, pct};
}).filter(x=>x.total>0).sort((a,b)=>b.total-a.total);

const addEntry = () => {
if (!desc.trim()||!amount) return;
onSave([{id:Date.now(),desc:desc.trim(),amount:parseFloat(amount)||0,cat,date},…spending]);
setDesc(””); setAmount(””); setShowAdd(false);
};

const deleteEntry = (id) => onSave(spending.filter(s=>s.id!==id));
const sc = (key) => SPEND_CATS.find(s=>s.key===key)||SPEND_CATS[6];

return (
<div>
<div style={{…S.card,background:“linear-gradient(135deg,#1a0f00,#0a1a0a)”,borderColor:”#fb923c44”}}>
<div style={{fontWeight:800,fontSize:17,color:”#fb923c”,marginBottom:12}}>💸 Spending Tracker</div>
<div style={{display:“grid”,gridTemplateColumns:“1fr 1fr 1fr”,gap:10}}>
{[[“Spent”,`$${totalSpend.toFixed(0)}`,”#fb923c”],[“Revenue”,`$${totalRevenue.toFixed(0)}`,”#4ade80”],[“Net”,`${netProfit>=0?"+":""}$${Math.abs(netProfit).toFixed(0)}`,netProfit>=0?”#4ade80”:”#f87171”]].map(([l,v,c])=>(
<div key={l} style={{textAlign:“center”,background:”#ffffff08”,borderRadius:10,padding:“10px 6px”}}>
<div style={{fontSize:20,fontWeight:800,color:c}}>{v}</div>
<div style={{fontSize:10,color:”#475569”,textTransform:“uppercase”,letterSpacing:1,marginTop:2}}>{l}</div>
</div>
))}
</div>
</div>

```
  <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}>
    <div style={{display:"flex",gap:4,background:"#0f0f1a",borderRadius:10,padding:4,border:"1px solid #ffffff0f",flex:1}}>
      {[["week","Week"],["month","Month"],["year","Year"],["all","All"]].map(([p,lbl])=>(
        <button key={p} onClick={()=>setPeriod(p)} style={{flex:1,padding:"7px 4px",borderRadius:7,border:"none",fontWeight:700,fontSize:11,cursor:"pointer",background:filterPeriod===p?"#ffffff18":"none",color:filterPeriod===p?"#e2e8f0":"#64748b"}}>{lbl}</button>
      ))}
    </div>
    <button style={{...S.btn("primary","#fb923c","#f0c040"),padding:"10px 14px"}} onClick={()=>setShowAdd(!showAdd)}>{showAdd?"✕":"+ Add"}</button>
  </div>

  {showAdd && (
    <div style={{...S.card,borderColor:"#fb923c33"}}>
      <div style={{fontWeight:700,marginBottom:12,color:"#fb923c"}}>Log a Purchase</div>
      <div style={{marginBottom:10}}>
        <label style={S.lbl}>Description</label>
        <input style={S.inp} placeholder="e.g. Bubble mailers, Card lot from garage sale..." value={desc} onChange={e=>setDesc(e.target.value)}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
        <div>
          <label style={S.lbl}>Amount ($)</label>
          <input style={S.inp} type="number" placeholder="0.00" value={amount} onChange={e=>setAmount(e.target.value)}/>
        </div>
        <div>
          <label style={S.lbl}>Date</label>
          <input style={{...S.inp,colorScheme:"dark"}} type="date" value={date} onChange={e=>setDate(e.target.value)}/>
        </div>
      </div>
      <div style={{marginBottom:14}}>
        <label style={S.lbl}>Category</label>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
          {SPEND_CATS.map(sc=>(
            <button key={sc.key} onClick={()=>setCat(sc.key)} style={{padding:"8px 4px",borderRadius:10,border:cat===sc.key?`2px solid ${sc.color}`:"2px solid #ffffff10",background:cat===sc.key?sc.color+"15":"#ffffff05",color:cat===sc.key?sc.color:"#64748b",fontWeight:700,fontSize:10,cursor:"pointer",textAlign:"center"}}>
              <div style={{fontSize:16,marginBottom:2}}>{sc.icon}</div>
              <div>{sc.label.split("/")[0]}</div>
            </button>
          ))}
        </div>
      </div>
      <button style={{...S.btn("primary","#fb923c","#f0c040"),width:"100%"}} onClick={addEntry} disabled={!desc.trim()||!amount}>💸 Log Expense</button>
    </div>
  )}

  {catBreakdown.length>0 && (
    <div style={S.card}>
      <div style={{fontWeight:700,marginBottom:12}}>Breakdown by Category</div>
      {catBreakdown.map(sc=>(
        <div key={sc.key} style={{marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:16}}>{sc.icon}</span>
              <span style={{fontSize:13,fontWeight:600,color:sc.color}}>{sc.label}</span>
              <span style={{fontSize:11,color:"#475569"}}>{sc.count} item{sc.count!==1?"s":""}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:12,color:"#64748b"}}>{sc.pct}%</span>
              <span style={{fontSize:14,fontWeight:700,color:"#e2e8f0"}}>${sc.total.toFixed(2)}</span>
            </div>
          </div>
          <div style={{background:"#ffffff10",borderRadius:99,height:5,overflow:"hidden"}}>
            <div style={{background:`linear-gradient(90deg,${sc.color},${sc.color}88)`,height:"100%",borderRadius:99,width:`${sc.pct}%`,transition:"width 0.4s"}}/>
          </div>
        </div>
      ))}
    </div>
  )}

  <div style={{display:"flex",gap:6,marginBottom:12,overflowX:"auto",paddingBottom:4}}>
    <button onClick={()=>setFilterCat("all")} style={{padding:"5px 12px",borderRadius:99,border:filterCat==="all"?"2px solid #94a3b8":"2px solid #ffffff10",background:filterCat==="all"?"#94a3b822":"none",color:filterCat==="all"?"#e2e8f0":"#64748b",fontWeight:700,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>All</button>
    {SPEND_CATS.map(sc=>(
      <button key={sc.key} onClick={()=>setFilterCat(sc.key)} style={{padding:"5px 12px",borderRadius:99,border:filterCat===sc.key?`2px solid ${sc.color}`:"2px solid #ffffff10",background:filterCat===sc.key?sc.color+"22":"none",color:filterCat===sc.key?sc.color:"#64748b",fontWeight:700,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>{sc.icon} {sc.label}</button>
    ))}
  </div>

  {filtered.length===0 ? (
    <div style={{...S.card,textAlign:"center",padding:36}}>
      <div style={{fontSize:40,marginBottom:10}}>💳</div>
      <div style={{color:"#64748b",marginBottom:8}}>No expenses yet for this period</div>
      <div style={{fontSize:12,color:"#475569"}}>Tap + Add to log — your inventory buys show up automatically</div>
    </div>
  ) : (
    <div style={S.card}>
      <div style={{fontSize:13,color:"#64748b",marginBottom:12}}>{filtered.length} transaction{filtered.length!==1?"s":""} · ${filtered.reduce((s,x)=>s+(x.amount||0),0).toFixed(2)} total</div>
      {filtered.map(item=>{
        const c=sc(item.cat);
        return (
          <div key={item.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid #ffffff08"}}>
            <div style={{width:36,height:36,borderRadius:10,background:c.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{c.icon}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",color:item.fromFlip?"#94a3b8":"#e2e8f0"}}>{item.desc}</div>
              <div style={{fontSize:11,color:"#475569",marginTop:2}}>{c.label} · {item.date}{item.fromFlip?" · auto from inventory":""}</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
              <span style={{fontSize:15,fontWeight:800,color:"#fb923c"}}>-${(item.amount||0).toFixed(2)}</span>
              {!item.fromFlip && <button style={{...S.btn("danger"),padding:"4px 10px",fontSize:11}} onClick={()=>deleteEntry(item.id)}>✕</button>}
            </div>
          </div>
        );
      })}
    </div>
  )}
</div>
```

);
}
