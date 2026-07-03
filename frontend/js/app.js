const state = {
  summary: null,
  authors: [],
  works: [],
  institutions: [],
  network: null,
  currentWindow: 'all',
  selectedInstitution: '',
  selectedAuthor: null,
  egoDepth: 1,
  simulation: null,
};

const fmt = new Intl.NumberFormat('en-US');
const $ = (id) => document.getElementById(id);
const institutionPalette = [
  '#58a6ff', '#f778ba', '#56d364', '#e3b341', '#a371f7', '#ff7b72',
  '#39c5cf', '#ffa657', '#7ee787', '#d2a8ff', '#79c0ff', '#db6d28',
  '#bc8cff', '#3fb950', '#f2cc60', '#ffab70', '#8ddb8c', '#c297ff',
];

async function loadJSON(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

function datasetPath(file) {
  return `data/${file}`;
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function statCard(label, value) {
  return `<div class="stat-card"><div class="value">${value}</div><div class="label">${label}</div></div>`;
}

function institutionKey(value) {
  const text = (value || 'Unknown institution').trim();
  return text || 'Unknown institution';
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function institutionColor(value) {
  const key = institutionKey(value);
  return institutionPalette[hashText(key) % institutionPalette.length];
}

function topInstitutionsFromNodes(nodes, limit = 120) {
  const counts = d3.rollups(
    nodes,
    (items) => d3.sum(items, (d) => d.window_works || d.works || 1),
    (d) => institutionKey(d.institution),
  );
  return counts
    .sort((a, b) => d3.descending(a[1], b[1]) || d3.ascending(a[0], b[0]))
    .slice(0, limit);
}

function populateWindowSelect() {
  const windows = state.summary?.available_windows || [{ value: 'all', label: 'All years' }];
  const select = $('windowSelect');
  select.innerHTML = windows.map(w => `<option value="${escapeHTML(w.value)}">${escapeHTML(w.label)}</option>`).join('');
  const fallback = state.summary?.default_window || windows[0]?.value || 'all';
  if (!windows.some(w => w.value === state.currentWindow)) state.currentWindow = fallback;
  select.value = state.currentWindow;
  syncWindowSlider();
}

function currentWindowIndex() {
  const windows = state.summary?.available_windows || [{ value: 'all', label: 'All years' }];
  return Math.max(0, windows.findIndex(w => w.value === state.currentWindow));
}

function syncWindowSlider() {
  const slider = $('yearSlider');
  const value = $('yearSliderValue');
  if (!slider || !value) return;
  const windows = state.summary?.available_windows || [{ value: 'all', label: 'All years' }];
  const index = currentWindowIndex();
  slider.max = String(Math.max(0, windows.length - 1));
  slider.value = String(index);
  value.textContent = windows[index]?.label || state.currentWindow;
}

function syncEgoDepthControls() {
  const depth = clamp(Number(state.egoDepth) || 1, 1, 3);
  state.egoDepth = depth;
  const select = $('egoDepthSelect');
  const slider = $('egoDepthSlider');
  const value = $('egoDepthSliderValue');
  if (select) select.value = String(depth);
  if (slider) slider.value = String(depth);
  if (value) value.textContent = `${depth} hop${depth > 1 ? 's' : ''}`;
}

function setEgoDepth(value) {
  state.egoDepth = clamp(Number(value) || 1, 1, 3);
  syncEgoDepthControls();
  if ($('modeSelect').value === 'ego' && state.selectedAuthor) drawGraph();
}

function renderStats() {
  const s = state.summary;
  const win = s.windows[state.currentWindow] || {};
  const isFiltered = Boolean(state.selectedInstitution || ($('modeSelect')?.value === 'ego' && state.selectedAuthor));
  const visible = state.network && isFiltered ? graphDataForMode() : null;
  $('stats').innerHTML = [
    statCard('Works', fmt.format(s.n_works)),
    statCard('Authorship rows', fmt.format(s.n_authorship_rows)),
    statCard('Indexed authors', fmt.format(s.n_authors_indexed)),
    statCard(isFiltered ? 'Visible nodes' : 'Window nodes', fmt.format(visible?.nodes?.length || win.nodes || state.network?.nodes?.length || 0)),
    statCard(isFiltered ? 'Visible edges' : 'Window edges', fmt.format(visible?.edges?.length || win.edges || state.network?.edges?.length || 0)),
  ].join('');
}

function populateInstitutionSelect() {
  const select = $('institutionSelect');
  const previous = state.selectedInstitution;
  const rows = topInstitutionsFromNodes(state.network.nodes);
  select.innerHTML = [
    '<option value="">All institutions</option>',
    ...rows.map(([name, weight]) => `<option value="${escapeHTML(name)}">${escapeHTML(name)} (${fmt.format(Math.round(weight))})</option>`),
  ].join('');
  if (previous && rows.some(([name]) => name === previous)) {
    select.value = previous;
  } else {
    select.value = '';
    state.selectedInstitution = '';
  }
}

function renderInstitutionLegend(nodes) {
  const selected = state.selectedInstitution;
  const rows = topInstitutionsFromNodes(nodes, selected ? 12 : 14);
  if (!rows.length) {
    $('institutionLegend').innerHTML = '<span class="muted">No institutions are visible in the current network.</span>';
    return;
  }
  $('institutionLegend').innerHTML = rows.map(([name, weight]) => `
    <button class="legend-row${selected === name ? ' active' : ''}" data-institution="${escapeHTML(name)}">
      <span class="swatch" style="background:${institutionColor(name)}"></span>
      <span class="legend-name">${escapeHTML(name)}</span>
      <span class="legend-count">${fmt.format(Math.round(weight))}</span>
    </button>
  `).join('');
  document.querySelectorAll('[data-institution]').forEach((el) => {
    el.addEventListener('click', () => {
      state.selectedInstitution = el.getAttribute('data-institution') || '';
      $('institutionSelect').value = state.selectedInstitution;
      drawGraph();
    });
  });
}

function renderYearChart() {
  const data = state.summary.yearly;
  const svg = d3.select('#yearChart');
  svg.selectAll('*').remove();
  const width = $('yearChart').clientWidth || 800;
  const height = 260;
  const margin = {top: 16, right: 24, bottom: 38, left: 52};
  svg.attr('viewBox', `0 0 ${width} ${height}`);
  const x = d3.scaleBand().domain(data.map(d => d.year)).range([margin.left, width - margin.right]).padding(0.18);
  const y = d3.scaleLinear().domain([0, d3.max(data, d => d.works)]).nice().range([height - margin.bottom, margin.top]);
  svg.append('g').attr('class','axis').attr('transform',`translate(0,${height-margin.bottom})`).call(d3.axisBottom(x).tickValues(data.map(d => d.year).filter((_,i)=>i%2===0)));
  svg.append('g').attr('class','axis').attr('transform',`translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(5));
  svg.selectAll('.bar').data(data).join('rect')
    .attr('class','bar')
    .attr('x', d => x(d.year))
    .attr('y', d => y(d.works))
    .attr('width', x.bandwidth())
    .attr('height', d => y(0)-y(d.works))
    .append('title').text(d => `${d.year}: ${fmt.format(d.works)} works`);
  svg.selectAll('.bar2').data(data).join('rect')
    .attr('class','bar2')
    .attr('x', d => x(d.year))
    .attr('y', d => y(d.international || 0))
    .attr('width', x.bandwidth())
    .attr('height', d => y(0)-y(d.international || 0))
    .append('title').text(d => `${d.year}: ${fmt.format(d.international || 0)} international works`);
}

function renderTypeList() {
  const top = state.summary.types.slice(0, 12);
  $('typeList').innerHTML = top.map(d => `<div class="type-row"><span>${escapeHTML(d.type || 'unknown')}</span><strong>${fmt.format(d.count)}</strong></div>`).join('');
}

async function loadNetwork(win) {
  state.currentWindow = win;
  state.network = await loadJSON(datasetPath(`network_${win}.json`));
  if ($('windowSelect')) $('windowSelect').value = win;
  syncWindowSlider();
  renderStats();
  populateInstitutionSelect();
  drawGraph();
}

function buildAdjacency(edges) {
  const adjacency = new Map();
  edges.forEach((edge) => {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
    adjacency.get(edge.source).push({ id: edge.target, edge });
    adjacency.get(edge.target).push({ id: edge.source, edge });
  });
  adjacency.forEach((items) => items.sort((a, b) => b.edge.weight - a.edge.weight));
  return adjacency;
}

function egoNetwork(nodes, edges, author, depth) {
  const maxDepth = Math.max(1, Math.min(3, Number(depth) || 1));
  const perNodeLimits = { 1: 90, 2: 36, 3: 18 };
  const maxNodes = { 1: 120, 2: 420, 3: 850 }[maxDepth];
  const adjacency = buildAdjacency(edges);
  const distance = new Map([[author.id, 0]]);
  let frontier = [author.id];

  for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth += 1) {
    const next = [];
    for (const id of frontier) {
      const neighbors = (adjacency.get(id) || []).slice(0, perNodeLimits[currentDepth]);
      for (const neighbor of neighbors) {
        if (!distance.has(neighbor.id)) {
          distance.set(neighbor.id, currentDepth);
          next.push(neighbor.id);
          if (distance.size >= maxNodes) break;
        }
      }
      if (distance.size >= maxNodes) break;
    }
    frontier = next;
    if (!frontier.length || distance.size >= maxNodes) break;
  }

  const keep = new Set(distance.keys());
  const keptEdges = edges
    .filter(e => keep.has(e.source) && keep.has(e.target))
    .sort((a, b) => {
      const da = Math.max(distance.get(a.source) || 0, distance.get(a.target) || 0);
      const db = Math.max(distance.get(b.source) || 0, distance.get(b.target) || 0);
      return d3.ascending(da, db) || d3.descending(a.weight, b.weight);
    })
    .slice(0, maxDepth === 1 ? 180 : maxDepth === 2 ? 900 : 1600);

  const edgeNodeIds = new Set([author.id]);
  keptEdges.forEach(e => { edgeNodeIds.add(e.source); edgeNodeIds.add(e.target); });
  const visibleNodes = nodes
    .filter(n => edgeNodeIds.has(n.id))
    .map(n => ({ ...n, ego_distance: distance.get(n.id) ?? null }));

  return { nodes: visibleNodes, edges: keptEdges };
}

function previewNetwork(nodes, edges, edgeLimit) {
  const previewEdges = edges.slice(0, edgeLimit);
  const keep = new Set();
  previewEdges.forEach(e => {
    keep.add(e.source);
    keep.add(e.target);
  });
  return {
    nodes: nodes.filter(n => keep.has(n.id)),
    edges: previewEdges,
  };
}

function graphDataForMode() {
  const mode = $('modeSelect').value;
  const net = state.network;
  const nodeById = new Map(net.nodes.map(n => [n.id, n]));
  let nodes = net.nodes;
  let edges = net.edges;
  let label = net.label || state.currentWindow;

  if (mode === 'ego' && state.selectedAuthor) {
    const selectedNode = nodes.find(n => n.id === state.selectedAuthor.id);
    if (!selectedNode) {
      return {
        label: `Ego ${state.egoDepth} hop: ${state.selectedAuthor.label} (not in ${label})`,
        nodes: [],
        edges: [],
      };
    }
    const ego = egoNetwork(nodes, edges, selectedNode, state.egoDepth);
    nodes = ego.nodes;
    edges = ego.edges;
    label = `Ego ${state.egoDepth} hop: ${state.selectedAuthor.label}`;
  } else if (state.selectedInstitution) {
    const seed = new Set(nodes.filter(n => institutionKey(n.institution) === state.selectedInstitution).map(n => n.id));
    const keep = new Set(seed);
    edges = edges.filter(e => seed.has(e.source) || seed.has(e.target));
    edges.forEach(e => { keep.add(e.source); keep.add(e.target); });
    nodes = nodes.filter(n => keep.has(n.id));
    label = state.selectedInstitution;
  } else {
    const preview = previewNetwork(nodes, edges, net.preview_edges || 12000);
    nodes = preview.nodes;
    edges = preview.edges;
  }

  return {
    label,
    nodes: nodes.map(n => nodeById.get(n.id) ? { ...nodeById.get(n.id), ego_distance: n.ego_distance } : n),
    edges,
  };
}

function drawGraph() {
  const net = graphDataForMode();
  $('graphTitle').textContent = `${net.label || state.currentWindow}: ${fmt.format(net.nodes.length)} nodes / ${fmt.format(net.edges.length)} edges`;
  renderStats();
  renderInstitutionLegend(net.nodes);
  const svg = d3.select('#graph');
  svg.selectAll('*').remove();
  const width = $('graph').clientWidth || 900;
  const height = $('graph').clientHeight || 630;
  svg.attr('viewBox', `0 0 ${width} ${height}`);
  const g = svg.append('g');
  const zoom = d3.zoom().scaleExtent([0.15, 6]).on('zoom', (event) => {
    g.attr('transform', event.transform);
  });
  svg.call(zoom);

  const nodes = net.nodes.map(d => ({...d}));
  const nodeMap = new Map(nodes.map(d => [d.id, d]));
  const edges = net.edges.filter(e => nodeMap.has(e.source) && nodeMap.has(e.target)).map(d => ({...d}));
  if (!nodes.length) {
    if (state.simulation) state.simulation.stop();
    g.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#8b949e')
      .attr('font-size', 14)
      .text('No matching author network in this year window.');
    return;
  }
  const maxW = d3.max(edges, d => d.weight) || 1;
  const maxWorks = d3.max(nodes, d => d.window_works || d.works || 1) || 1;

  const link = g.append('g').selectAll('line').data(edges).join('line')
    .attr('class','link')
    .attr('stroke-width', d => 0.4 + 2.8 * Math.sqrt(d.weight / maxW));

  const node = g.append('g').selectAll('circle').data(nodes).join('circle')
    .attr('class', d => 'node' + (state.selectedAuthor && d.id === state.selectedAuthor.id ? ' highlight' : ''))
    .attr('r', d => 3.2 + 10 * Math.sqrt((d.window_works || d.works || 1) / maxWorks))
    .attr('fill', d => state.selectedAuthor && d.id === state.selectedAuthor.id ? '#ffdf5d' : institutionColor(d.institution))
    .attr('opacity', d => state.selectedInstitution && institutionKey(d.institution) !== state.selectedInstitution ? 0.58 : 0.95)
    .attr('stroke-width', d => state.selectedAuthor && d.id === state.selectedAuthor.id ? 2.8 : d.ego_distance ? Math.max(0.8, 2.4 - d.ego_distance * 0.45) : 1.1)
    .on('click', (event, d) => {
      state.selectedAuthor = { id: d.id, label: d.label };
      showAuthorDetails(d);
      if ($('modeSelect').value === 'ego') drawGraph();
      else highlightNode(d.id);
    })
    .call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended));

  const labelCutoff = nodes.length ? d3.quantile(nodes.map(n => n.window_works || n.works || 0).sort(d3.ascending), 0.93) : Infinity;
  const labels = g.append('g').selectAll('text').data(nodes.filter(d => (d.window_works || d.works || 0) >= labelCutoff)).join('text')
    .attr('class','label')
    .text(d => d.label?.slice(0, 28) || '')
    .attr('dy', -8);

  node.append('title').text(d => `${d.label}\nWorks: ${d.works}\nInstitution: ${d.institution || 'unknown'}${d.ego_distance ? `\nEgo distance: ${d.ego_distance}` : ''}`);

  if (state.simulation) state.simulation.stop();
  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(edges).id(d => d.id).distance(d => 28 + 30 / Math.sqrt(d.weight || 1)).strength(0.13))
    .force('charge', d3.forceManyBody().strength(-52))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => 5 + 10 * Math.sqrt((d.window_works || d.works || 1) / maxWorks)))
    .alpha(0.9);
  state.simulation = simulation;
  simulation.on('tick', () => {
    link.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    node.attr('cx', d => d.x).attr('cy', d => d.y);
    labels.attr('x', d => d.x + 8).attr('y', d => d.y - 8);
  });

  function dragstarted(event, d) { if (!event.active) simulation.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; }
  function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
  function dragended(event, d) { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }
}

function highlightNode(id) {
  d3.selectAll('.node')
    .classed('highlight', d => d.id === id)
    .attr('fill', d => d.id === id ? '#ffdf5d' : institutionColor(d.institution));
}

function showAuthorDetails(d) {
  const author = state.authors.find(a => a.id === d.id) || d;
  $('nodeDetails').innerHTML = `
    <strong>${escapeHTML(author.label || d.label)}</strong><br/>
    <span class="small">${escapeHTML(author.id || d.id)}</span><br/><br/>
    Works: <strong>${fmt.format(author.works || d.works || 0)}</strong><br/>
    Window works: <strong>${fmt.format(d.window_works || 0)}</strong><br/>
    International works: <strong>${fmt.format(author.international_works || d.international_works || 0)}</strong><br/>
    Institution: <strong>${escapeHTML(author.institution || d.institution || 'unknown')}</strong><br/>
    Active years: <strong>${author.first_year || '?'}-${author.last_year || '?'}</strong><br/><br/>
    <button onclick="setEgoMode('${d.id.replaceAll("'", "\\'")}')">View ego network</button>
  `;
}

window.setEgoMode = function(id) {
  const a = state.authors.find(x => x.id === id) || state.network.nodes.find(x => x.id === id);
  if (a) state.selectedAuthor = { id: a.id, label: a.label };
  $('modeSelect').value = 'ego';
  drawGraph();
};

function search() {
  const q = $('searchInput').value.trim().toLowerCase();
  if (!q) {
    $('searchResults').innerHTML = '<span class="muted">Type a keyword to search authors, institutions, and papers.</span>';
    return;
  }
  const authors = state.authors.filter(a => `${a.label} ${a.institution} ${a.country}`.toLowerCase().includes(q)).slice(0, 8);
  const inst = state.institutions.filter(i => `${i.display_name} ${i.city}`.toLowerCase().includes(q)).slice(0, 5);
  const works = state.works.filter(w => `${w.title} ${w.year} ${w.type}`.toLowerCase().includes(q)).slice(0, 6);
  const parts = [];
  authors.forEach(a => parts.push(`<div class="result" data-author="${escapeHTML(a.id)}"><div class="title">Author ${escapeHTML(a.label)}</div><div class="meta">${fmt.format(a.works)} works · ${escapeHTML(a.institution || 'unknown')} · ${a.first_year || '?'}-${a.last_year || '?'}</div></div>`));
  inst.forEach(i => parts.push(`<div class="result"><div class="title">Institution ${escapeHTML(i.display_name)}</div><div class="meta">${escapeHTML(i.city || '')} · works_count ${escapeHTML(i.works_count || '')}</div></div>`));
  works.forEach(w => parts.push(`<div class="result"><div class="title">Paper ${escapeHTML((w.title || 'Untitled').slice(0, 110))}</div><div class="meta">${w.year || ''} · ${escapeHTML(w.type || '')} · ${w.n_authors || 0} authors · ${w.international ? 'international' : 'domestic/local'}</div></div>`));
  $('searchResults').innerHTML = parts.length ? parts.join('') : '<span class="muted">No matches found.</span>';
  document.querySelectorAll('[data-author]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-author');
      const author = state.authors.find(a => a.id === id);
      state.selectedAuthor = author;
      $('modeSelect').value = 'ego';
      drawGraph();
      showAuthorDetails(author);
    });
  });
}

async function init() {
  $('stats').innerHTML = '<div class="stat-card"><div class="value">Loading</div><div class="label">Reading data...</div></div>';
  const [summary, authors, works, institutions] = await Promise.all([
    loadJSON(datasetPath('summary.json')),
    loadJSON(datasetPath('authors_index.json')),
    loadJSON(datasetPath('works_index.json')),
    loadJSON(datasetPath('institutions.json')),
  ]);
  state.summary = summary;
  state.authors = authors;
  state.works = works;
  state.institutions = institutions;
  state.currentWindow = summary.default_window || summary.available_windows?.[0]?.value || 'all';
  populateWindowSelect();
  syncEgoDepthControls();
  renderYearChart();
  renderTypeList();
  await loadNetwork(state.currentWindow);

  $('windowSelect').addEventListener('change', async (e) => await loadNetwork(e.target.value));
  $('yearSlider').addEventListener('input', async (e) => {
    const windows = state.summary?.available_windows || [{ value: 'all', label: 'All years' }];
    const index = clamp(Number(e.target.value) || 0, 0, windows.length - 1);
    const win = windows[index]?.value;
    if (win && win !== state.currentWindow) await loadNetwork(win);
    else syncWindowSlider();
  });
  $('institutionSelect').addEventListener('change', (e) => {
    state.selectedInstitution = e.target.value;
    drawGraph();
  });
  $('egoDepthSelect').addEventListener('change', (e) => setEgoDepth(e.target.value));
  $('egoDepthSlider').addEventListener('input', (e) => setEgoDepth(e.target.value));
  $('applyBtn').addEventListener('click', () => { search(); drawGraph(); });
  $('resetBtn').addEventListener('click', () => {
    state.selectedAuthor = null;
    state.selectedInstitution = '';
    state.egoDepth = 1;
    $('modeSelect').value = 'full';
    $('institutionSelect').value = '';
    syncEgoDepthControls();
    drawGraph();
    $('nodeDetails').innerHTML = 'Click a network node to inspect it.';
  });
  $('searchInput').addEventListener('input', () => search());
  $('modeSelect').addEventListener('change', () => drawGraph());
  window.addEventListener('resize', () => { renderYearChart(); drawGraph(); });
}

init().catch(err => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#ff7b72; padding:24px">${err.stack || err}</pre>`;
});
