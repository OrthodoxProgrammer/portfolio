(function () {
  var tenure = document.getElementById('familyTenure');
  if (!tenure) return;

  var calendar = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: 'numeric'
  });
  var plurals = new Intl.PluralRules('ru');
  var monthWords = { one: 'месяц', few: 'месяца', many: 'месяцев', other: 'месяца' };

  function updateTenure() {
    var date = {};
    calendar.formatToParts(new Date()).forEach(function (part) {
      date[part.type] = part.value;
    });
    // Count calendar months since April 2026; the exact start day is unknown.
    var months = (Number(date.year) - 2026) * 12 + Number(date.month) - 4;
    if (months < 0) return;

    tenure.textContent = months === 0
      ? 'Меньше месяца на\u00a0проекте'
      : months + '\u00a0' + monthWords[plurals.select(months)] + ' на\u00a0проекте';
  }

  updateTenure();
  // Keep the count current when the page stays open across a month boundary.
  window.setInterval(updateTenure, 60000);
})();
