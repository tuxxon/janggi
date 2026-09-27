// 장기 규칙·탐색 — Janggi.jsx 원본에서 로직 변경 없이 떼어냈다.
const PV={K:0,R:1300,C:700,H:500,E:300,A:300,P:200};
const ORTH=[[1,0],[-1,0],[0,1],[0,-1]];
const DIAGS=[[[0,3],[1,4],[2,5]],[[0,5],[1,4],[2,3]],[[7,3],[8,4],[9,5]],[[7,5],[8,4],[9,3]]];
const on=(r,c)=>r>=0&&r<10&&c>=0&&c<9;
const inPal=(r,c)=>c>=3&&c<=5&&(r<=2||r>=7);
const DL=[];for(let i=0;i<90;i++){const r=(i/9)|0,c=i%9;DL.push(DIAGS.map(L=>[L,L.findIndex(p=>p[0]===r&&p[1]===c)]).filter(x=>x[1]>=0));}
const other=s=>s==='c'?'h':'c';
const SETUPS={'마상마상':'HEHE','상마상마':'EHEH','마상상마':'HEEH','상마마상':'EHHE'};

function newBoard(choSetup,hanSetup){
  const b=new Array(90).fill(null);
  const put=(r,c,p)=>{b[r*9+c]=p;};
  // 한 (위쪽, rows 0-3)
  put(0,0,'hR');put(0,8,'hR');put(0,3,'hA');put(0,5,'hA');put(1,4,'hK');
  put(2,1,'hC');put(2,7,'hC');for(const c of[0,2,4,6,8])put(3,c,'hP');
  const hs=SETUPS[hanSetup];[7,6,2,1].forEach((c,k)=>put(0,c,'h'+hs[k]));
  // 초 (아래쪽, rows 6-9)
  put(9,0,'cR');put(9,8,'cR');put(9,3,'cA');put(9,5,'cA');put(8,4,'cK');
  put(7,1,'cC');put(7,7,'cC');for(const c of[0,2,4,6,8])put(6,c,'cP');
  const cs=SETUPS[choSetup];[1,2,6,7].forEach((c,k)=>put(9,c,'c'+cs[k]));
  return b;
}

function gen(b,side){
  const mv=[];const fwd=side==='c'?-1:1;
  for(let i=0;i<90;i++){
    const p=b[i];if(!p||p[0]!==side)continue;
    const r=(i/9)|0,c=i%9,t=p[1];
    const add=(nr,nc)=>{if(!on(nr,nc))return false;const j=nr*9+nc,q=b[j];if(q&&q[0]===side)return false;mv.push([i,j]);return !q;};
    if(t==='K'||t==='A'){
      for(const[dr,dc]of ORTH){const nr=r+dr,nc=c+dc;if(on(nr,nc)&&inPal(nr,nc))add(nr,nc);}
      for(const[L,k]of DL[i])for(const j of[k-1,k+1])if(j>=0&&j<3)add(L[j][0],L[j][1]);
    }else if(t==='R'){
      for(const[dr,dc]of ORTH){let nr=r+dr,nc=c+dc;while(on(nr,nc)){if(!add(nr,nc))break;nr+=dr;nc+=dc;}}
      for(const[L,k]of DL[i])for(const d of[-1,1]){let j=k+d;while(j>=0&&j<3){if(!add(L[j][0],L[j][1]))break;j+=d;}}
    }else if(t==='C'){
      for(const[dr,dc]of ORTH){
        let nr=r+dr,nc=c+dc;
        while(on(nr,nc)&&!b[nr*9+nc]){nr+=dr;nc+=dc;}
        if(!on(nr,nc)||b[nr*9+nc][1]==='C')continue;
        nr+=dr;nc+=dc;
        while(on(nr,nc)){const q=b[nr*9+nc];
          if(!q)mv.push([i,nr*9+nc]);
          else{if(q[0]!==side&&q[1]!=='C')mv.push([i,nr*9+nc]);break;}
          nr+=dr;nc+=dc;}
      }
      for(const[L,k]of DL[i]){if(k===1)continue;
        const sc=b[L[1][0]*9+L[1][1]];if(!sc||sc[1]==='C')continue;
        const ti=L[2-k][0]*9+L[2-k][1],q=b[ti];
        if(!q||(q[0]!==side&&q[1]!=='C'))mv.push([i,ti]);}
    }else if(t==='H'){
      for(const[dr,dc]of ORTH){const r1=r+dr,c1=c+dc;if(!on(r1,c1)||b[r1*9+c1])continue;
        if(dr){add(r1+dr,c1-1);add(r1+dr,c1+1);}else{add(r1-1,c1+dc);add(r1+1,c1+dc);}}
    }else if(t==='E'){
      for(const[dr,dc]of ORTH){const r1=r+dr,c1=c+dc;if(!on(r1,c1)||b[r1*9+c1])continue;
        const ds=dr?[[dr,-1],[dr,1]]:[[-1,dc],[1,dc]];
        for(const[a,e]of ds){const r2=r1+a,c2=c1+e;if(!on(r2,c2)||b[r2*9+c2])continue;add(r2+a,c2+e);}}
    }else if(t==='P'){
      add(r+fwd,c);add(r,c-1);add(r,c+1);
      for(const[L,k]of DL[i])for(const j of[k-1,k+1])if(j>=0&&j<3&&L[j][0]-r===fwd)add(L[j][0],L[j][1]);
    }
  }
  return mv;
}
const kingIdx=(b,s)=>b.indexOf(s+'K');
function inCheck(b,s){const k=kingIdx(b,s);if(k<0)return true;return gen(b,other(s)).some(m=>m[1]===k);}
function make(b,m){const cap=b[m[1]];b[m[1]]=b[m[0]];b[m[0]]=null;return cap;}
function unmake(b,m,cap){b[m[0]]=b[m[1]];b[m[1]]=cap;}
function legal(b,s){return gen(b,s).filter(m=>{const cap=make(b,m);const ok=!inCheck(b,s);unmake(b,m,cap);return ok;});}

function evalB(b,side){
  let sc=0;
  for(let i=0;i<90;i++){const p=b[i];if(!p)continue;const r=(i/9)|0,c=i%9;let v=PV[p[1]];
    if(p[1]==='P')v+=12*Math.max(0,p[0]==='c'?6-r:r-3);
    if(p[1]==='H'||p[1]==='C')v+=c>=2&&c<=6?15:0;
    sc+=p[0]===side?v:-v;}
  return sc;
}
const WIN=100000;

function order(b,ms){return ms.map(m=>{const q=b[m[1]];return[q?PV[q[1]]*10-PV[b[m[0]][1]]:0,m];}).sort((x,y)=>y[0]-x[0]).map(x=>x[1]);}
function qs(b,side,alpha,beta,d){
  
  const ms=gen(b,side);
  for(const m of ms){const q=b[m[1]];if(q&&q[1]==='K')return WIN;}
  const stand=evalB(b,side);
  if(d===0||stand>=beta)return stand;
  if(stand>alpha)alpha=stand;
  for(const m of order(b,ms.filter(m=>b[m[1]]))){
    const cap=make(b,m);const v=-qs(b,other(side),-beta,-alpha,d-1);unmake(b,m,cap);
    if(v>=beta)return v;if(v>alpha)alpha=v;}
  return alpha;
}
function search(b,side,depth,alpha,beta){
  
  const ms=gen(b,side);
  for(const m of ms){const q=b[m[1]];if(q&&q[1]==='K')return WIN+depth;}
  if(depth===0)return qs(b,side,alpha,beta,4);
  if(!ms.length)return 0;
  let best=-Infinity;
  for(const m of order(b,ms)){
    const cap=make(b,m);const v=-search(b,other(side),depth-1,-beta,-alpha);unmake(b,m,cap);
    if(v>best)best=v;if(v>alpha)alpha=v;if(alpha>=beta)break;}
  return best;
}
function bestMove(b,side,depth){
  const ms=order(b,legal(b,side));if(!ms.length)return null;
  let best=null,bv=-Infinity,alpha=-Infinity;
  for(const m of ms){
    const cap=make(b,m);const v=-search(b,other(side),depth-1,-Infinity,-alpha+30)+Math.random()*20;unmake(b,m,cap);
    if(v>bv){bv=v;best=m;}if(v>alpha)alpha=v;}
  return best;
}

export { PV, WIN, SETUPS, on, inPal, other, newBoard, gen, kingIdx, inCheck, make, unmake, legal, evalB, bestMove };
