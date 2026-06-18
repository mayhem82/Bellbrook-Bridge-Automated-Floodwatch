/* Keeps the Chart.js hover tooltip clear of the selected node. */
(function () {
  if (!window.Chart || !Chart.Tooltip || !Chart.Tooltip.positioners) return;

  Chart.Tooltip.positioners.offsetClearNode = function (elements, eventPosition) {
    if (!elements.length) return false;

    const point = Chart.Tooltip.positioners.nearest.call(this, elements, eventPosition);
    if (!point) return false;

    const area = this.chart.chartArea;
    const yAbove = point.y - 74;
    const yBelow = point.y + 74;
    const y = yAbove > area.top + 10 ? yAbove : Math.min(yBelow, area.bottom - 10);
    const x = Math.max(area.left + 70, Math.min(point.x + 18, area.right - 70));

    return { x, y };
  };
})();