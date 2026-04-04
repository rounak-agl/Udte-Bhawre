// renderer/control-centre/core/markdown.js

const PFMarkdown = {
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  render(text) {
    if (!text) return '';
    
    // 1. Extract code blocks BEFORE escaping (so backticks survive)
    const codeBlocks = [];
    // Strip bbox blocks entirely (vision legacy)
    text = text.replace(/```bbox\s*\n?[\s\S]*?```/g, '');
    // Extract fenced code blocks
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const placeholder = `%%CODEBLOCK_${codeBlocks.length}%%`;
      codeBlocks.push(`<pre class="pf-code-block"><code>${this.escapeHtml(code.trim())}</code></pre>`);
      return placeholder;
    });
    // Extract inline code
    const inlineCodes = [];
    text = text.replace(/`([^`]+)`/g, (_, code) => {
      const placeholder = `%%INLINECODE_${inlineCodes.length}%%`;
      inlineCodes.push(`<code class="pf-inline-code">${this.escapeHtml(code)}</code>`);
      return placeholder;
    });

    // 2. Now escape the remaining HTML
    let html = this.escapeHtml(text);

    // 3. Bold (non-greedy)
    html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>');

    // 4. Italic (non-greedy)
    html = html.replace(/\*([\s\S]*?)\*/g, '<em>$1</em>');

    // 5. Headings (### h3, ## h2, # h1)
    html = html.replace(/^### (.+)$/gm, '<h4 class="pf-heading-sm">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 class="pf-heading-md">$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2 class="pf-heading-lg">$1</h2>');

    // 6. Unordered list items
    html = html.replace(/^[\-\*] (.+)$/gm, '<li class="pf-list-item">$1</li>');

    // 7. Ordered list items
    html = html.replace(/^\d+\. (.+)$/gm, '<li class="pf-list-item pf-ordered">$1</li>');

    // 8. Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="pf-link" target="_blank">$1</a>');

    // 9. Line breaks
    html = html.replace(/\n/g, '<br>');

    // 10. Restore code blocks and inline code
    codeBlocks.forEach((block, i) => {
      html = html.replace(`%%CODEBLOCK_${i}%%`, block);
    });
    inlineCodes.forEach((code, i) => {
      html = html.replace(`%%INLINECODE_${i}%%`, code);
    });

    return html;
  }
};

window.PFMarkdown = PFMarkdown;
