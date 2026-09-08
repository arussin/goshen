import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const mime = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.json':'application/json' };
const port = Number(process.env.PORT || 4173);
createServer(async(req,res)=>{
  try {
    const requestUrl=new URL(req.url,'http://localhost');
    const pathname=decodeURIComponent(requestUrl.pathname);
    if(pathname==='/preview/slow-signal.svg'||pathname==='/preview/slow-parser.js'){
      const delay=Math.max(0,Math.min(10000,Number(requestUrl.searchParams.get('ms'))||0));
      setTimeout(()=>{
        if(res.destroyed)return;
        const parser=pathname==='/preview/slow-parser.js';
        res.writeHead(200,{'Content-Type':parser?'text/javascript; charset=utf-8':'image/svg+xml','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        res.end(parser?'/* Fictional fixture: delayed download, no busy loop. */':'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="none"/></svg>');
      },delay);
      return;
    }
    if(pathname==='/'){res.writeHead(302,{'Location':'/preview/index.html'}).end();return;}
    const path=resolve(root,'.'+(pathname==='/'?'/preview/index.html':pathname));
    if(!path.startsWith(root+sep)){res.writeHead(403).end('Forbidden');return;}
    if(!(await stat(path)).isFile()){res.writeHead(404).end('Not found');return;}
    res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    const contents=await readFile(path);
    const parse=Math.max(0,Math.min(10000,Number(requestUrl.searchParams.get('parse'))||0));
    // A parser-blocking download leaves visible content on screen while the
    // document is still loading. Restricted to the fictional site fixtures.
    if(parse&&pathname.startsWith('/preview/sites/')&&extname(path)==='.html'){
      res.end(contents.toString('utf8').replace('</body>',`<script src="/preview/slow-parser.js?ms=${parse}"></script></body>`));
    }else res.end(contents);
  }catch{res.writeHead(404).end('Not found');}
}).listen(port,'127.0.0.1',()=>process.stdout.write(`Goshen Terminal preview: http://127.0.0.1:${port}\n`));
