import fetch from 'node-fetch';

const REQUIRED = ['domain','plta','pltc'];   

const json = (res,obj,status=200) => res.status(status).json(obj);

const bail = (res,msg,status=400) => json(res,{error:msg},status);

const getCreds = req => {
  const u = new URL(req.url, `https://${req.headers.host}`);
  const out = {};
  for(const k of REQUIRED) out[k] = u.searchParams.get(k);
  return out;
};

const chkCreds = c => REQUIRED.every(k => c[k] && c[k].trim()!=='');

const fetchPT = async (path,{method='GET',body=null,admin=false}={}) => {
  const opts = {
    method,
    headers:{
      Accept:'application/json',
      'Content-Type':'application/json',
      Authorization:`Bearer ${admin ? global.pltc : global.plta}`
    }
  };
  if(body) opts.body = JSON.stringify(body);
  const url = `${global.domain}/api/application/${path}`.replace(/\/+/g,'/');
  return fetch(url,opts);
};

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();

  const creds = getCreds(req);
  if(!chkCreds(creds)) return bail(res,'Missing query: domain, plta, pltc');
  global.domain = creds.domain.replace(/\/+$/,'');  
  global.plta    = creds.plta;
  global.pltc    = creds.pltc;

  if(req.method==='GET' && req.url==='/'){
    return json(res,{
      message:'Pterodactyl Universal Proxy – Online',
      endpoints:{
        'GET  /':'Status & docs',
        'GET  /servers':'List semua server',
        'DELETE /server/:id':'Hapus server',
        'POST /create':'Buat panel+server (body: username,email,ram,disk?,cpu?)',
        'GET  /admins':'List admin',
        'DELETE /admin/:id':'Hapus admin',
        'POST /create-admin':'Buat admin (body: username,email)'
      },
      query:'?domain=<panel>&plta=<client-key>&pltc=<admin-key>'
    });
  }

  if(req.method==='GET' && req.url.startsWith('/servers')){
    const r = await fetchPT('servers');
    if(!r.ok) return bail(res,'Gagal ambil server',r.status);
    const j = await r.json();
    return json(res, j.data || []);
  }


  if(req.method==='DELETE' && req.url.match(/^\/server\/\d+$/)){
    const id = req.url.split('/')[2];
    const r  = await fetchPT(`servers/${id}`,{method:'DELETE'});
    return json(res,{success:r.ok});
  }

  if(req.method==='POST' && req.url==='/create'){
    const b = req.body;
    if(!b.username||!b.email||typeof b.ram!=='number')
      return bail(res,'Body wajib: username, email, ram (number)');
    const u = b.username.trim().toLowerCase();
    const e = b.email.trim().toLowerCase();
    const p = u + Math.floor(Math.random()*10000);
    const n = u + '-server';

    const user = await fetchPT('users',{
      method:'POST',
      body:{email:e,username:u,first_name:u,last_name:'User',password:p,language:'en'}
    });
    if(!user.ok){
      const x = await user.json().catch(()=>({}));
      return bail(res,x.errors?.[0]?.detail||'Gagal buat user');
    }
    const uid = (await user.json()).attributes.id;

    const egg = await fetchPT('nests/5/eggs/15');
    if(!egg.ok) return bail(res,'Gagal ambil egg');
    const eggJ = await egg.json();
    const startup = eggJ.attributes.startup;

    const server = await fetchPT('servers',{
      method:'POST',
      body:{
        name:n,
        user:uid,
        egg:15,
        docker_image:eggJ.attributes.docker_image,
        startup,
        environment:{INST:'npm',USER_UPLOAD:'0',AUTO_UPDATE:'0',CMD_RUN:'npm start'},
        limits:{
          memory:b.ram,
          swap:0,
          disk:b.disk||b.ram,
          io:500,
          cpu:b.cpu??100
        },
        feature_limits:{databases:5,backups:5,allocations:5},
        deploy:{locations:[1],dedicated_ip:false,port_range:[]}
      }
    });
    if(!server.ok){
      const x = await server.json().catch(()=>({}));
      return bail(res,x.errors?.[0]?.detail||'Gagal buat server');
    }
    const srv = await server.json();
    return json(res,{
      username:u,
      password:p,
      email:e,
      panel_url:global.domain,
      server_id:srv.attributes.id
    });
  }

  if(req.method==='GET' && req.url==='/admins'){
    const r = await fetchPT('users',{admin:true});
    if(!r.ok) return bail(res,'Gagal ambil admin',r.status);
    const j = await r.json();
    const list = (j.data||[])
      .filter(x=>x.attributes?.root_admin&&x.attributes.username)
      .map(x=>({id:x.attributes.id,username:x.attributes.username.trim()}));
    return json(res,list);
  }

  if(req.method==='DELETE' && req.url.match(/^\/admin\/\d+$/)){
    const id = req.url.split('/')[2];
    const r  = await fetchPT(`users/${id}`,{method:'DELETE',admin:true});
    return json(res,{success:r.ok});
  }

  if(req.method==='POST' && req.url==='/create-admin'){
    const b = req.body;
    if(!b.username||!b.email) return bail(res,'Body wajib: username, email');
    const u = b.username.trim();
    const e = b.email.trim();
    const p = u + Math.floor(Math.random()*10000);

    const r = await fetchPT('users',{
      method:'POST',
      admin:true,
      body:{email:e,username:u,first_name:u,last_name:'Admin',password:p,language:'en',root_admin:true}
    });
    if(!r.ok){
      const x = await r.json().catch(()=>({}));
      return bail(res,x.errors?.[0]?.detail||'Gagal buat admin');
    }
    return json(res,{username:u,password:p,panel_url:global.domain});
  }

  return bail(res,'Endpoint tidak ditemukan',404);
}