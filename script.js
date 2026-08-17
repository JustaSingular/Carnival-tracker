// Trinidad Carnival is the Monday and Tuesday immediately before Ash Wednesday,
// which is 46 days before Easter Sunday. Easter moves each year, so we compute it.

// Anonymous Gregorian algorithm for Easter Sunday.
function getEasterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}

// Carnival Monday = Easter - 48 days (Ash Wednesday is Easter - 46).
function getCarnivalMonday(year) {
    const easter = getEasterSunday(year);
    return new Date(year, easter.getMonth(), easter.getDate() - 48);
}

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// The next Carnival Monday from today. We only roll over to next year after
// Carnival Tuesday, so the countdown stays on this year's fete during the two days.
function getNextCarnivalMonday(today) {
    let carnival = getCarnivalMonday(today.getFullYear());
    const carnivalTuesday = new Date(carnival.getFullYear(), carnival.getMonth(), carnival.getDate() + 1);
    if (startOfDay(carnivalTuesday) < startOfDay(today)) {
        carnival = getCarnivalMonday(today.getFullYear() + 1);
    }
    return carnival;
}

function getDaysUntilCarnival(today) {
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const carnival = getNextCarnivalMonday(today);
    return Math.round((startOfDay(carnival) - startOfDay(today)) / MS_PER_DAY);
}

function renderCountdown() {
    const today = new Date();
    const days = getDaysUntilCarnival(today);
    const carnival = getNextCarnivalMonday(today);

    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const carnivalDate = carnival.toLocaleDateString('en-TT', dateOptions);

    const countEl = document.querySelector('.countdown-number');
    const labelEl = document.querySelector('.countdown-label');
    const dateEl = document.querySelector('.countdown-date');

    if (days === 0) {
        countEl.textContent = "It's Carnival Monday!";
        labelEl.textContent = 'Play mas!';
        dateEl.textContent = carnivalDate;
        return;
    }

    if (days === -1) {
        countEl.textContent = "It's Carnival Tuesday!";
        labelEl.textContent = 'Last lap!';
        dateEl.textContent = carnivalDate;
        return;
    }

    countEl.textContent = days;
    labelEl.textContent = days === 1 ? 'day till Carnival' : 'days till Carnival';
}

document.addEventListener('DOMContentLoaded', renderCountdown);
