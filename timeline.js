/**
 * Teacher Timeline Interactive Module — ОПТИМИЗИРОВАННЫЙ
 * Частицы рисуются только когда секция видна.
 */
(function() {
  'use strict';

  function initTimeline() {
    var canvas = document.getElementById('ambient-canvas');
    if (canvas) {
      var ctx = canvas.getContext('2d');
      var width, height;
      var particles = [];
      var running = false;
      var rafId = 0;

      function resize() {
        var rect = canvas.parentElement.getBoundingClientRect();
        width = canvas.width = rect.width;
        height = canvas.height = rect.height;
      }
      window.addEventListener('resize', resize, {passive: true});
      resize();

      function Particle(init) {
        this.reset(init);
      }
      Particle.prototype.reset = function(init) {
        this.x = Math.random() * width;
        this.y = init ? Math.random() * height : height + 10;
        this.size = Math.random() * 2 + 0.8;
        this.speedY = Math.random() * 0.35 + 0.1;
        this.speedX = (Math.random() - 0.5) * 0.25;
        this.opacity = Math.random() * 0.45 + 0.15;
        this.fade = Math.random() * 0.002 + 0.001;
      };
      Particle.prototype.update = function() {
        this.y -= this.speedY;
        this.x += this.speedX;
        this.opacity -= this.fade;
        if (this.y < -10 || this.opacity <= 0) this.reset(false);
      };
      Particle.prototype.draw = function() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(164,114,224,' + this.opacity.toFixed(3) + ')';
        ctx.fill();
      };

      for (var i = 0; i < 24; i++) particles.push(new Particle(true));

      function loop() {
        if (!running) return;
        ctx.clearRect(0, 0, width, height);
        for (var i = 0; i < particles.length; i++) {
          particles[i].update();
          particles[i].draw();
        }
        rafId = requestAnimationFrame(loop);
      }

      function startLoop() {
        if (running) return;
        running = true;
        rafId = requestAnimationFrame(loop);
      }
      function stopLoop() {
        running = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      }

      // Запускаем только когда секция видна
      if ('IntersectionObserver' in window) {
        var obs = new IntersectionObserver(function(entries) {
          entries.forEach(function(entry) {
            if (entry.isIntersecting) startLoop();
            else stopLoop();
          });
        }, { threshold: 0.05 });
        obs.observe(canvas.closest('.teacher-timeline-section') || canvas.parentElement);
      } else {
        startLoop();
      }
    }

    // 3D-наклон фотокарточки
    var photoCard = document.getElementById('tiltCard');
    if (photoCard) {
      photoCard.addEventListener('mousemove', function(e) {
        var rect = photoCard.getBoundingClientRect();
        var x = e.clientX - rect.left - rect.width / 2;
        var y = e.clientY - rect.top - rect.height / 2;
        var rotateX = (y / (rect.height / 2)) * -4;
        var rotateY = (x / (rect.width / 2)) * 4;
        photoCard.style.transform = 'perspective(800px) rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg) translateY(-4px)';
      }, {passive: true});
      photoCard.addEventListener('mouseleave', function() {
        photoCard.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg) translateY(0px)';
      }, {passive: true});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTimeline);
  } else {
    initTimeline();
  }
})();
