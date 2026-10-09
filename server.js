async function loadKeys() {
  const r = await api('/api/admin/keys');
  if (!r.success) return;
  const tbody = document.getElementById('keysTable');
  if (!r.keys.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">nenhuma key cadastrada</td></tr>`;
    return;
  }
  tbody.innerHTML = r.keys.map(k => {
    const notActivated = k.expires_at === 0;
    const expired = !notActivated && Date.now() > k.expires_at;
    
    let exp, status;
    if (notActivated) {
      exp = 'aguardando';
      status = '<span class="badge warn">⏳ aguardando</span>';
    } else {
      exp = new Date(k.expires_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' });
      if (!k.active) status = '<span class="badge warn">pausada</span>';
      else if (expired) status = '<span class="badge bad">expirada</span>';
      else status = '<span class="badge ok">ativa</span>';
    }
    
    const pauseBtn = k.active
      ? `<button class="ghost yellow" onclick="toggle('${k.key}')">pausar</button>`
      : `<button class="ghost green" onclick="toggle('${k.key}')">reativar</button>`;
      
    return `<tr>
      <td><span class="key-cell" onclick="copy('${k.key}')">${k.key}</span></td>
      <td>${status}</td>
      <td style="color:var(--txt-2);font-size:10.5px">${exp}</td>
      <td class="hwid-cell">${k.hwid ? k.hwid.slice(0,10)+'…' : '—'}</td>
      <td>
        <div class="actions">
          ${pauseBtn}
          <button class="ghost" onclick="resetHwid('${k.key}')">reset</button>
          <button class="ghost red" onclick="del('${k.key}')">del</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}
