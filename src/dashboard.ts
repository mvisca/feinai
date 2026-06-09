// Bun embeds this file as a string at compile time — works in both dev and compiled binary
import dashboardHtml from './dashboard.html' with { type: 'text' };
export { dashboardHtml };
