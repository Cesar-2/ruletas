const axios = require('axios');
(async ()=>{
  try{
    const res = await axios.get('https://api.dofusdu.de/dofus3/v1/es/items/resources/all', { timeout: 20000 });
    const data = res.data;
    const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
    console.log('got', items.length);
  }catch(e){
    console.error('err', e.message || e);
  }
})();
