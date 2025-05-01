
  window.MathJax = {
    tex: {
      inlineMath: [['$', '$'], ['\\(', '\\)']],
      displayMath: [['$$', '$$'], ['\\[', '\\]']],
      processEscapes: true,
      processEnvironments: true
    },
    options: {
      skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre']
    },
    startup: {
      ready: function() {
        MathJax.startup.defaultReady();
        // Define a global function to safely typeset LaTeX content
        window.renderMathJax = function(element) {
          if (MathJax && MathJax.typesetPromise) {
            MathJax.typesetPromise([element]).catch(function(err) {
              console.error('MathJax error:', err);
            });
          }
        };
      }
    }
  };
