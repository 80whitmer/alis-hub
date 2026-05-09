/**
 * templates-loader.js
 * Load and manage job templates from templates.json
 */

const fs = require('fs');
const path = require('path');

let cachedTemplates = null;

function loadTemplates() {
  if (cachedTemplates) return cachedTemplates;

  const templatesPath = path.join(__dirname, 'templates.json');

  if (!fs.existsSync(templatesPath)) {
    throw new Error(`templates.json not found at ${templatesPath}`);
  }

  try {
    const raw = fs.readFileSync(templatesPath, 'utf8');
    const data = JSON.parse(raw);
    cachedTemplates = data.templates || [];
    return cachedTemplates;
  } catch (err) {
    throw new Error(`Failed to load templates: ${err.message}`);
  }
}

function getTemplate(templateId) {
  const templates = loadTemplates();
  const template = templates.find(t => t.id === templateId);

  if (!template) {
    throw new Error(`Template '${templateId}' not found`);
  }

  return template;
}

function getAllTemplates() {
  return loadTemplates();
}

function getTemplateMetadata(templateId) {
  const template = getTemplate(templateId);
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    icon: template.icon,
  };
}

module.exports = {
  loadTemplates,
  getTemplate,
  getAllTemplates,
  getTemplateMetadata,
};
