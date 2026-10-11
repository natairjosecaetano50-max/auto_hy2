/**
 * Enrollment Form Interactive Module
 * Школа классического вокала Екатерины Заремба
 */
(function () {
  'use strict';

  var card = document.getElementById('vzCard');
  var form = document.getElementById('vzForm');
  if (!form || !card) return;

  var hp = form.querySelector('[name="form-control"]');
  var email = form.querySelector('[name="email"]');
  var phone = form.querySelector('[name="phone"]');
  var succEmail = card.querySelector('.vz-success-email');
  var attach = card.querySelector('.vz-attach');
  var chip = attach ? attach.querySelector('.vz-chip') : null;

  // Функция отображения результата теста в плашке вложения
  function updateVoiceTestAttachment(result) {
    if (!attach || !result) return;
    attach.hidden = false;
    if (chip) {
      chip.innerHTML = 'Тест: ' + result.score + '% (' + result.level + ') <button type="button" aria-label="Убрать вложение">×</button>';
      var btn = chip.querySelector('button');
      if (btn) {
        btn.addEventListener('click', function () {
          attach.hidden = true;
        });
      }
    }
  }

  // Проверяем сохранённый результат теста в sessionStorage
  try {
    var savedResult = sessionStorage.getItem('voiceTestResult');
    if (savedResult) {
      var parsed = JSON.parse(savedResult);
      if (parsed && parsed.score !== undefined) {
        updateVoiceTestAttachment(parsed);
      }
    }
  } catch (e) {}

  // Слушаем событие "Записаться с результатом" от модуля проверки голоса
  document.addEventListener('voicetest:enroll', function (e) {
    var res = e.detail;
    if (res) {
      updateVoiceTestAttachment(res);
    }
    var enrollSec = document.getElementById('record') || document.getElementById('signup');
    if (enrollSec) {
      enrollSec.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    var fnInput = document.getElementById('vz-fn');
    if (fnInput) {
      setTimeout(function () { fnInput.focus(); }, 600);
    }
  });

  // Стилизация select при выборе значения
  form.querySelectorAll('select').forEach(function (s) {
    var update = function () { s.classList.toggle('is-filled', !!s.value); };
    update();
    s.addEventListener('change', update);
  });

  // Маска телефонного номера
  if (phone) {
    phone.addEventListener('input', function () {
      var d = phone.value.replace(/\D/g, '');
      if (!d) { phone.value = ''; return; }
      if (d[0] === '8') d = '7' + d.slice(1);
      if (d[0] !== '7') d = '7' + d;
      d = d.slice(0, 11);
      var o = '+7';
      if (d.length > 1) o += ' (' + d.slice(1, 4);
      if (d.length >= 5) o += ') ' + d.slice(4, 7);
      if (d.length >= 8) o += '-' + d.slice(7, 9);
      if (d.length >= 10) o += '-' + d.slice(9, 11);
      phone.value = o;
    });
  }

  // Кнопка удаления прикреплённого теста
  if (attach) {
    var btnClose = attach.querySelector('button');
    if (btnClose) {
      btnClose.addEventListener('click', function () {
        attach.hidden = true;
      });
    }
  }

  // Обработка отправки формы
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (hp && hp.value) { form.reset(); return; } // honeypot защита от спам-ботов
    if (succEmail) succEmail.textContent = email ? email.value : '';
    card.classList.add('is-sent');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Отправить ещё одну заявку
  var again = card.querySelector('.vz-again');
  if (again) {
    again.addEventListener('click', function () {
      card.classList.remove('is-sent');
      form.reset();
      form.querySelectorAll('select').forEach(function (s) { s.classList.remove('is-filled'); });
      if (attach) attach.hidden = false;
    });
  }
})();
