import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const hash=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const results=[];
for(const [app, origin] of [['admin','https://taebaek-staff.web.app'],['staff','https://taebaek-3abe4.web.app']]) {
 const dir=`dist/${app}`, localHtml=readFileSync(`${dir}/index.html`,'utf8');
 const entry=localHtml.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
 const remoteHtml=await (await fetch(`${origin}/?verify=${Date.now()}`,{cache:'no-store'})).text();
 if(!entry||!remoteHtml.includes(entry)) throw new Error(`Entry differs: ${app}`);
 const paths=[entry,...readdirSync(`${dir}/assets`).filter(name=>/^(AdminApp|TradeStatement)-.*\.js$/.test(name)).map(name=>`/assets/${name}`)];
 for(const path of paths){const response=await fetch(`${origin}${path}`);if(!response.ok)throw new Error(`${app} ${path}: ${response.status}`);const remote=Buffer.from(await response.arrayBuffer()),local=readFileSync(`${dir}${path}`);if(hash(remote)!==hash(local))throw new Error(`SHA differs: ${path}`);results.push({app,path,sha256:hash(local),matched:true});}
}
writeFileSync('outputs/latest-request-deploy-verification.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
