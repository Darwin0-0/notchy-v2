// Minimal DOM surface shared by the Health and real cell-grid interaction tests.
function fixture() {
  const document={activeElement:null};
  const matches=(node,selector)=>selector.split(',').some(part=>{part=part.trim();if(part.includes('>')){const [parent,child]=part.split('>').map(value=>value.trim());return !!node.parentElement&&matches(node,child)&&matches(node.parentElement,parent);}if(part.startsWith('#'))return node.id===part.slice(1);if(part.startsWith('.'))return node.className.split(/\s+/).includes(part.slice(1));const attribute=part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);if(attribute){const name=attribute[1],key=name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value=name.startsWith('data-')?node.dataset[key]:node.attributes[name];return value!==undefined&&(attribute[2]===undefined||String(value)===attribute[2]);}return node.tagName===part;});
  class Element {
    constructor(tag){this.tagName=tag;this.ownerDocument=document;this.children=[];this.dataset={};this.attributes={};this.style={setProperty(key,value){this[key]=value;}};this.listeners={};this.className='';this._text='';this.classList={add:(...values)=>{this.className+=' '+values.join(' ');}};}
    set textContent(value){this._text=String(value);for(const child of this.children)child.parentElement=null;this.children=[];}
    get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    setAttribute(key,value){this.attributes[key]=String(value);}
    removeAttribute(key){delete this.attributes[key];}
    append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
    insertBefore(node,before){node.remove();node.parentElement=this;const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,node);}
    prepend(...nodes){for(const node of nodes.reverse()){node.remove();node.parentElement=this;this.children.unshift(node);}}
    replaceChildren(...nodes){this.textContent='';this.append(...nodes);}
    replaceWith(node){const parent=this.parentElement;if(parent){parent.insertBefore(node,this);this.remove();}}
    remove(){if(this.parentElement){const list=this.parentElement.children;list.splice(list.indexOf(this),1);this.parentElement=null;}}
    contains(node){return this===node||this.children.some(child=>child.contains(node));}
    closest(selector){return matches(this,selector)?this:this.parentElement?.closest(selector)||null;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    querySelectorAll(selector){return this.children.flatMap(child=>[...(matches(child,selector)?[child]:[]),...child.querySelectorAll(selector)]);}
    addEventListener(name,callback){this.listeners[name]=callback;}
    removeEventListener(name,callback){if(this.listeners[name]===callback)delete this.listeners[name];}
    focus(){if(!this.disabled)document.activeElement=this;}
    get isConnected(){return document.body.contains(this);}
    get childNodes(){return this.children;}
    get childElementCount(){return this.children.length;}
    cloneNode(deep){const clone=new Element(this.tagName);clone.className=this.className;clone.textContent=this._text;Object.assign(clone.attributes,this.attributes);if(deep)clone.append(...this.children.map(child=>child.cloneNode(true)));return clone;}
    getBoundingClientRect(){return this.rect||{left:0,top:0,width:812,height:368};}
  }
  document.createElement=tag=>new Element(tag);document.createElementNS=(_,tag)=>new Element(tag);document.body=new Element('body');
  const healthHost=new Element('section'),modulesHost=new Element('section'),toolbar=new Element('div');document.body.append(healthHost,modulesHost,toolbar);
  const all=(node,predicate)=>[...(predicate(node)?[node]:[]),...node.children.flatMap(child=>all(child,predicate))];
  const event=(host,type,node,extra={})=>{const value={type,target:node,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};if(!node?.disabled)host.listeners[type]?.(value);return value;};
  const click=(host,node)=>event(host,'click',node);
  return{document,healthHost,modulesHost,toolbar,all,click,event};
}
module.exports={fixture};
