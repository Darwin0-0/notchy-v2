(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.NotchyReception=api;
})(typeof window==='object'?window:null,function(){
  'use strict';
  const paths={
    phone:'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M11 18h2',
    desktop:'M5 6h14v9H5z M3 18h18',
    image:'M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M4 16l5-5 4 4 3-3 4 4 M9 9.5h.01',
    document:'M7 3h7l5 5v12a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V4.5A1.5 1.5 0 0 1 7 3z M14 3v5h5 M9 13h7 M9 17h5',
    archive:'M5 4h14v16H5z M12 4v7 M10 7h4 M10 11h4 M10 15h4',
    download:'M12 4v11 M7 10l5 5 5-5 M5 20h14',
    close:'M6 6l12 12 M18 6L6 18',
    check:'M5 12.5l4.5 4.5L19 7.5'
  };
  function fileKind(name=''){
    if(!String(name).includes('.'))return 'document';
    const ext=String(name).split('.').pop().toLowerCase();
    return /^(png|jpe?g|webp|gif|heic|avif|bmp|tiff?)$/.test(ext)?'image':/^(zip|7z|rar|tar|gz)$/.test(ext)?'archive':'document';
  }
  function size(state,stage,detail='summary'){
    if(state==='rest')return{width:220,height:36};
    if(state==='compact')return{width:360,height:58};
    return{width:520,height:stage==='consent'?(detail==='list'?262:176):['progress','waiting','cancelled','rejected'].includes(stage)?132:176};
  }
  function expiration(incoming,now=Date.now()){
    if(typeof incoming?.expiresAt!=='number'||typeof incoming?.createdAt!=='number')return null;
    const end=incoming.expiresAt,start=incoming.createdAt;
    if(!Number.isFinite(end)||!Number.isFinite(start)||end<=start)return null;
    return Math.max(0,Math.min(1,(end-now)/(end-start)));
  }
  // Derive speed only from fresh measured bytes; no synthetic ETA or clock-driven progress.
  function meter(){
    let previous=null,rate=null;
    return function sample(transfer,now=Date.now()){
      if(!transfer||!['receiving','waiting'].includes(transfer.status)){previous=null;rate=null;return null;}
      if(typeof transfer.transferredBytes!=='number')return null;
      const bytes=transfer.transferredBytes;
      if(!Number.isFinite(bytes)||bytes<0)return null;
      if(!previous||previous.id!==transfer.id||bytes<previous.bytes||now<=previous.at){previous={id:transfer.id,bytes,at:now};rate=null;return null;}
      const elapsed=now-previous.at;
      if(elapsed>=250&&bytes>previous.bytes){rate=(bytes-previous.bytes)*1000/elapsed;previous={id:transfer.id,bytes,at:now};}
      else if(elapsed>3000)rate=null;
      return rate;
    };
  }
  function create({document,t,formatSize,motion}){
    const el=id=>document.getElementById(id),text=(node,value)=>{if(node.textContent!==String(value))node.textContent=String(value);};
    const card=el('reception-card'),sample=meter();
    let fileKey='',stackKey='',previousStage='',previousFile='';
    function svg(kind){
      const node=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS(node.namespaceURI,'path');
      node.setAttribute('viewBox','0 0 24 24');node.setAttribute('aria-hidden','true');path.setAttribute('d',paths[kind]||paths.document);if(kind==='check')path.setAttribute('pathLength','1');node.append(path);return node;
    }
    function fileIcon(file){const node=document.createElement('span');node.className='reception-file-icon';node.dataset.kind=fileKind(file.name);node.append(svg(node.dataset.kind));return node;}
    function render(value,{incoming,busy=false,detail='summary',canReveal=false,error=''}={}){
      card.hidden=!value;
      if(!value)return;
      const stage=value.stage,transfer=value.transfer,count=value.count,files=value.files||[],completed=Math.max(0,Number(transfer?.completedFileCount)||0);
      const single=files.length===1,mode=single?'single':detail;
      card.dataset.stage=stage;card.dataset.detail=mode;card.dataset.motion=String(motion());
      el('localsend-consent').hidden=stage!=='consent';el('shelf-incoming').hidden=stage!=='consent';
      el('reception-transfer').hidden=!['waiting','progress'].includes(stage);
      el('reception-result').hidden=!['complete','cancelled','rejected','error'].includes(stage);
      el('reception-result-actions').hidden=el('reception-result').hidden;
      const device=el('reception-request-device');
      device.replaceChildren(svg(incoming?.deviceType==='mobile'||transfer?.deviceType==='mobile'?'phone':'desktop'));
      text(el('shelf-incoming-sender'),value.alias||t('Appareil LocalSend'));
      text(el('reception-eyebrow'),t('DEMANDE DE PARTAGE'));
      text(el('shelf-incoming-files'),single?files[0].name+'\n'+formatSize(files[0].size):t('veut t’envoyer {count} fichiers · {size}',{count,size:formatSize(value.bytes)}));
      el('shelf-incoming-files').title=files.map(file=>file.name).join('\n');
      for(const id of ['shelf-incoming-accept','shelf-incoming-reject'])el(id).disabled=busy||!incoming;
      text(el('shelf-incoming-accept'),t(count>1&&mode==='list'?'Tout accepter':'Accepter'));
      text(el('shelf-incoming-reject'),t('Refuser'));
      const remaining=expiration(incoming),expiry=el('reception-expiry');expiry.hidden=remaining===null||single;
      if(remaining!==null){expiry.style.setProperty('--reception-remaining',remaining);expiry.setAttribute('aria-label',t('Demande disponible pendant {seconds} s',{seconds:Math.ceil(remaining*(incoming.expiresAt-incoming.createdAt)/1000)}));}
      el('reception-preview').hidden=!single;
      if(single){const preview=el('reception-preview');if(preview.dataset.name!==files[0].name){preview.replaceChildren(svg(fileKind(files[0].name)));preview.dataset.name=files[0].name;preview.dataset.kind=fileKind(files[0].name);}}
      for(const stack of card.querySelectorAll('.reception-stack'))stack.hidden=single||!files.length||stage==='consent'&&mode==='list';
      const nextStack=JSON.stringify(files.slice(0,3).map(file=>file.name));
      if(stackKey!==nextStack){for(const stack of card.querySelectorAll('.reception-stack'))stack.replaceChildren(...files.slice(0,3).map(fileIcon));stackKey=nextStack;}
      for(const stack of card.querySelectorAll('.reception-stack'))stack.setAttribute('aria-label',t('Voir les fichiers de la demande'));
      const list=el('reception-files');list.hidden=mode!=='list'||stage!=='consent';
      const key=JSON.stringify(files.map(file=>[file.name,file.size]));
      if(fileKey!==key){list.replaceChildren(...files.map(file=>{const row=document.createElement('li'),name=document.createElement('span'),bytes=document.createElement('small');name.className='reception-file-name';name.textContent=file.name;name.title=file.name;bytes.textContent=formatSize(file.size);row.append(fileIcon(file),name,bytes);return row;}));fileKey=key;}
      text(el('reception-peer'),t('Réception depuis {device}',{device:value.alias}));
      const current=transfer?.currentFile,name=current?.name||(stage==='waiting'?t('Connexion à l’appareil…'):count===1&&files[0]?files[0].name:t('{count} fichiers',{count}));
      text(el('reception-current-file'),name);el('reception-current-file').title=name;
      const nextFile=transfer?.id+':'+name;
      if(previousFile!==nextFile&&previousStage===stage&&motion())el('reception-current-file').animate([{opacity:0,transform:'translateY(-8px)',filter:'blur(4px)'},{opacity:1,transform:'none',filter:'blur(0)'}],{duration:400,easing:'cubic-bezier(.22,1,.36,1)'});
      previousFile=nextFile;previousStage=stage;
      const percent=Math.max(0,Math.min(stage==='complete'?100:99,Number(value.progress)||0));
      text(el('reception-counter'),current?.index?current.index+' / '+count:stage==='waiting'?'':Math.round(percent)+' %');
      el('reception-cancel').disabled=busy||!transfer||!['waiting','preparing','receiving'].includes(transfer.status);
      text(el('reception-bytes'),formatSize(transfer?.transferredBytes||0)+' / '+formatSize(value.bytes));
      const rate=sample(transfer);text(el('reception-rate'),rate===null?'':formatSize(rate)+'/s');
      const progress=el('reception-progress');if(stage==='waiting')progress.removeAttribute('aria-valuenow');else progress.setAttribute('aria-valuenow',Math.round(percent));progress.style.setProperty('--reception-progress',percent/100);
      el('reception-result').dataset.success=String(stage==='complete');
      const resultIcon=el('reception-result-icon'),kind=stage==='complete'?'check':stage==='error'?'document':'close';
      if(resultIcon.dataset.kind!==kind){resultIcon.replaceChildren(svg(kind));resultIcon.dataset.kind=kind;}
      const received=t(count===1?'{count} fichier reçu':'{count} fichiers reçus',{count});
      text(el('reception-result-title'),stage==='complete'?received:stage==='cancelled'?t('Envoi annulé'):stage==='rejected'?t('Demande refusée'):t('Réception interrompue'));
      text(el('reception-result-detail'),stage==='complete'?t('Enregistrés dans l’Étagère · {size}',{size:formatSize(value.bytes)}):completed?t('{count} fichier(s) conservé(s) dans l’Étagère · {size}',{count:completed,size:formatSize(transfer.receivedBytes||0)}):value.error||t('Aucun fichier complet reçu pour cette demande.'));
      const shelf=el('reception-shelf'),reveal=el('reception-reveal');
      shelf.dataset.localsendCommand=completed||stage==='complete'?'shelf':'done';
      text(shelf,t(completed||stage==='complete'?'Étagère':'Fermer'));
      reveal.hidden=!(completed||stage==='complete');reveal.disabled=busy;
      reveal.dataset.localsendCommand=canReveal?'reveal':'shelf';text(reveal,t(canReveal?'Ouvrir le dossier':'Voir les fichiers'));
      const errorNode=el('reception-action-error');errorNode.hidden=!error;text(errorNode,error);
    }
    return{render};
  }
  return Object.freeze({size,fileKind,expiration,meter,paths,create});
});
