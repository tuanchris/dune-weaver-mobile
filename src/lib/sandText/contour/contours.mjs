// Vendored from sand-weaver contours.js (commit 4f07abb, 2026-10-05) for the text generator's
// contour fill (contourFill.mjs). Edit there first; keep this a copy.

// Marching squares over a scalar field. Shared edge IDs make loops topological,
// independent of floating point equality. Saddle cells are paired around their
// high corners, preserving disjoint interiors rather than creating X crossings.
export function isolines(field, n, level, step) {
  const links = new Map(), positions = new Map();
  const edge = (x, y, side) => {
    let ax=x, ay=y, bx=x, by=y, key;
    if(side===0){bx++;key=`h${y*n+x}`;} else if(side===1){ax++;bx++;by++;key=`v${y*n+x+1}`;}
    else if(side===2){ay++;by++;bx++;key=`h${(y+1)*n+x}`;} else {by++;key=`v${y*n+x}`;}
    if(!positions.has(key)){
      const a=field[ay*n+ax],b=field[by*n+bx],t=(level-a)/(b-a);
      positions.set(key,[((ax+(bx-ax)*t)-(n-1)/2)*step,((ay+(by-ay)*t)-(n-1)/2)*step]);
    } return key;
  };
  const join=(a,b)=>{if(!links.has(a))links.set(a,[]);if(!links.has(b))links.set(b,[]);links.get(a).push(b);links.get(b).push(a);};
  for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++){
    const v=[field[y*n+x],field[y*n+x+1],field[(y+1)*n+x+1],field[(y+1)*n+x]], crossed=[];
    for(let e=0;e<4;e++)if((v[e]>=level)!==(v[(e+1)%4]>=level))crossed.push(e);
    if(crossed.length===2)join(edge(x,y,crossed[0]),edge(x,y,crossed[1]));
    else if(crossed.length===4){const pairs=v[0]>=level?[[3,0],[1,2]]:[[0,1],[2,3]];for(const[a,b]of pairs)join(edge(x,y,a),edge(x,y,b));}
  }
  const seen=new Set(),loops=[];
  for(const start of links.keys()){
    if(seen.has(start))continue;
    const loop=[];let key=start,previous=null;
    while(!seen.has(key)){
      seen.add(key);loop.push(positions.get(key));const next=links.get(key)?.find(k=>k!==previous);previous=key;key=next;
      if(key===undefined)break;
    }
    if(key===start&&loop.length>=4)loops.push(loop);
  }
  return loops;
}

export function distanceField(mask,n){
  const distance=new Float64Array(n*n).fill(1e6);
  for(let i=0;i<distance.length;i++)if(!mask[i])distance[i]=0;
  // Chamfer approximation with an extended stencil. Fine interpolation happens
  // in isolines; no staircase mesh vertices are exported as contour corners.
  const moves=[[-1,0,1],[0,-1,1],[-1,-1,Math.SQRT2],[1,-1,Math.SQRT2],[-2,-1,Math.sqrt(5)],[2,-1,Math.sqrt(5)],[-1,-2,Math.sqrt(5)],[1,-2,Math.sqrt(5)]];
  for(const sign of [1,-1])for(let k=0;k<n*n;k++){
    const i=sign===1?k:n*n-1-k,x=i%n,y=Math.floor(i/n);if(!mask[i])continue;
    for(const[dx,dy,w]of moves){const xx=x+sign*dx,yy=y+sign*dy;if(xx>=0&&xx<n&&yy>=0&&yy<n)distance[i]=Math.min(distance[i],distance[yy*n+xx]+w);}
  }
  let smooth=distance;
  for(let pass=0;pass<2;pass++){
    const next=smooth.slice();
    for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++){
      const i=y*n+x;next[i]=(smooth[i]*4+smooth[i-1]+smooth[i+1]+smooth[i-n]+smooth[i+n])/8;
    }smooth=next;
  }
  return smooth;
}

function nearest(a,b){
  let best={distance:Infinity,a:0,b:0};
  // Bounding box checks could accelerate this further; retaining all vertices
  // here avoids missed narrow portals from coarse point subsampling.
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){
    const dx=a[i][0]-b[j][0],dy=a[i][1]-b[j][1],d=dx*dx+dy*dy;
    if(d<best.distance)best={distance:d,a:i,b:j};
  }return best;
}
function area(loop){let sum=0;for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length];sum+=a[0]*b[1]-b[0]*a[1];}return Math.abs(sum)/2;}

export function contourPlan(tone,{lines=240,table=700,ball=10,depth=3.2,strength=.85,minFeature=0}={}){
  if(![lines,table,ball,depth,strength,minFeature].every(Number.isFinite)||table<100||table>3000||ball<1||ball>50||strength<0||strength>1||depth<=0||depth>ball/2||minFeature<0||minFeature>3)throw new Error('Invalid physical settings.');
  const n=Math.max(96,Math.min(360,Math.round(lines)+40)),step=1.96/(n-1),mask=new Uint8Array(n*n);
  for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++){
    const xx=(x-(n-1)/2)*step,yy=(y-(n-1)/2)*step;
    if(Math.hypot(xx,yy)<.955){let value=0;for(const[dx,dy,w]of [[0,0,4],[-1,0,1],[1,0,1],[0,-1,1],[0,1,1]])value+=tone(xx+dx*step,yy+dy*step)*w;mask[y*n+x]=value/8>.48?1:0;}
  }
  const distance=distanceField(mask,n),grooveMm=2*Math.sqrt(ball*depth-depth*depth);
  // Density must not reward sub-ball spacing. This is a conservative baseline,
  // not a clearance guarantee for curved contours and their bridge junctions.
  const pitchMm=ball*(1.8-.6*strength),pitch=pitchMm*2/table/step;
  const loops=[];
  let layer=0;
  for(let level=.5;level<distance.reduce((a,b)=>Math.max(a,b),0);level+=pitch){
    const current=isolines(distance,n,level,step);
    for(const points of current)if(area(points)>Math.max(Math.pow(grooveMm/table,2)*.35,Math.PI*Math.pow(ball/table*minFeature,2)))loops.push({points,layer,children:[]});
    layer++;
  }
  if(!loops.length)throw new Error('No printable regions found. Increase contrast or use a larger source feature.');
  if(loops.length>300)throw new Error('Too many isolated regions. Increase contrast or reduce image noise.');
  // Prim over whole contour components: each accepted connection merges two
  // already disjoint components. Connections are explicit edges in the plan.
  let root=0,rootIndex=0,maxRadius=-1;
  for(let i=0;i<loops.length;i++)for(let j=0;j<loops[i].points.length;j++){
    const r=Math.hypot(...loops[i].points[j]);if(r>maxRadius){maxRadius=r;root=i;rootIndex=j;}
  }
  const connected=new Uint8Array(loops.length),candidate=Array(loops.length).fill(null);connected[root]=1;
  let added=root;
  for(let count=1;count<loops.length;count++){
    for(let j=0;j<loops.length;j++)if(!connected[j]){
      // Choose the shortest available bridge; audit the exported trajectory
      // separately rather than assuming this heuristic guarantees clearance.
      const a=loops[added],b=loops[j],near=nearest(a.points,b.points);
      const score=near.distance;
      if(!candidate[j]||score<candidate[j].score)candidate[j]={...near,score,parent:added};
    }
    let child=-1;
    for(let j=0;j<loops.length;j++)if(!connected[j]&&(child<0||candidate[j].score<candidate[child].score))child=j;
    const best=candidate[child];loops[best.parent].children.push({at:best.a,child,entry:best.b});connected[child]=1;added=child;
  }
  const path=[],events=[],finish=[],bridges=[];
  const append=(p,kind,region)=>{path.push(p);events.push({index:path.length-1,kind,region});};
  const entry=loops[root].points[rootIndex];append([entry[0]/maxRadius,entry[1]/maxRadius],'entry',root);append(entry,'corridor',root);
  // Traverse each closed contour once. At an attachment, complete the child
  // subtree before continuing the parent, then return on the exact bridge.
  const stack=[{id:root,entry:rootIndex,offset:0,child:0}];
  while(stack.length){
    const state=stack[stack.length-1],loop=loops[state.id],index=(state.entry+state.offset)%loop.points.length;
    if(state.offset===loop.points.length){finish.push({region:state.id,index:path.length-1});stack.pop();if(stack.length){const parent=stack[stack.length-1],p=loops[parent.id].points[(parent.entry+parent.offset)%loops[parent.id].points.length];append(p,'retrace',parent.id);}continue;}
    const children=loop.children.filter(c=>c.at===index);
    if(state.child<children.length){const c=children[state.child++],from=loop.points[index],to=loops[c.child].points[c.entry];bridges.push({from,to,parent:state.id,child:c.child});append(to,'corridor',c.child);stack.push({id:c.child,entry:c.entry,offset:0,child:0});continue;}
    if(state.offset<loop.points.length){state.offset++;state.child=0;append(loop.points[(state.entry+state.offset)%loop.points.length],'fill',state.id);}
  }
  append(path[0],'retrace',root);
  return{path,events,finish,bridges,loops:loops.map(({points,layer})=>({points,layer})),pitchMm,grooveMm};
}
