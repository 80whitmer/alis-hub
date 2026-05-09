# ALIS Hub — Design System Guide

Modern, professional, and inviting automation interface for ALIS communities.

---

## 🎨 Color Palette

### Primary Colors — Trust & Professionalism

```css
/* Navy — Primary brand color */
--primary-600: #1a3a52   /* Dark navy (headers, buttons) */
--primary-700: #152d3f
--primary-800: #0f1e2e   /* Darkest (text) */
--primary-900: #0a1420

/* Lighter shades for hover states */
--primary-500: #2c5aa0
--primary-400: #4a85c5
--primary-300: #7da8d8
```

**Usage:** Headers, primary buttons, links, navigation

### Accent Colors — Modern & Inviting

```css
/* Teal — Action, CTAs, highlights */
--accent-400: #00a896    /* Primary accent */
--accent-500: #008878    /* Darker accent */
--accent-600: #006b5f

/* Lighter for backgrounds */
--accent-300: #26d0ce
--accent-200: #99efeb
--accent-100: #ccf7f5
```

**Usage:** Call-to-action buttons, links, highlights, status indicators

### Status Colors

```css
--success: #10b981       /* Green — success, active */
--warning: #f59e0b       /* Amber — running, pending */
--error: #ef4444         /* Red — failed, errors */
--info: #3b82f6          /* Blue — information */
```

### Neutral Scale — Clean & Minimal

```css
--neutral-50: #f9fafb    /* Page background */
--neutral-100: #f3f4f6   /* Light backgrounds */
--neutral-200: #e5e7eb   /* Light borders */
--neutral-300: #d1d5db   /* Subtle borders */
--neutral-400: #9ca3af   /* Secondary text */
--neutral-500: #6b7280   /* Body text */
--neutral-700: #374151   /* Dark text */
--neutral-900: #111827   /* Darkest text */
```

**Usage:** Backgrounds, borders, text, dividers

---

## 🔤 Typography

### Font Stack

```css
/* Body text — System fonts for consistency */
font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

/* Monospace — For code, logs, technical data */
font-family: 'Fira Code', 'Courier New', monospace;
```

### Text Styles

| Style | Size | Weight | Color | Usage |
|-------|------|--------|-------|-------|
| **H1** | 2.25rem | Bold | primary-900 | Page title |
| **H2** | 1.875rem | Bold | primary-800 | Section header |
| **H3** | 1.5rem | Semibold | primary-700 | Subsection |
| **H4** | 1.25rem | Semibold | primary-700 | Card title |
| **Body** | 1rem | Regular | neutral-700 | Paragraph text |
| **Small** | 0.875rem | Regular | neutral-600 | Secondary text |
| **XSmall** | 0.75rem | Regular | neutral-500 | Captions, hints |

---

## 🎛️ Component Library

### Buttons

**Primary Button** — For main actions
```jsx
<button className="btn-primary">
  Create Job
</button>
```
Color: Teal accent background, white text
Hover: Darker teal
Disabled: Gray

**Secondary Button** — For secondary actions
```jsx
<button className="btn-secondary">
  Cancel
</button>
```
Color: Light gray background, primary text
Hover: Medium gray

**Accent Button** — For important CTAs
```jsx
<button className="btn-accent">
  Deploy
</button>
```
Color: Teal (primary accent)

**Ghost Button** — Minimal style
```jsx
<button className="btn-ghost">
  Learn More
</button>
```
Color: Text only, no background

**Danger Button** — For destructive actions
```jsx
<button className="btn-danger">
  Delete
</button>
```
Color: Red

**Size Variants:**
```jsx
<button className="btn-primary btn-sm">Small</button>
<button className="btn-primary">Default</button>
<button className="btn-primary btn-lg">Large</button>
```

### Cards

**Standard Card**
```jsx
<div className="card">
  <h3>Card Title</h3>
  <p>Card content goes here</p>
</div>
```
White background, subtle shadow, subtle border

**Small Card**
```jsx
<div className="card-sm">
  Compact content
</div>
```
Smaller padding for dense layouts

### Input Fields

```jsx
<div className="input-group">
  <label className="input-label">Email</label>
  <input type="email" placeholder="your@email.com" />
  <p className="input-help">Enter your work email</p>
</div>
```

**With Error State:**
```jsx
<input className="border-error" />
<p className="input-error">Email is required</p>
```

### Badges & Status

**Status Badges**
```jsx
<span className="badge badge-success">Completed</span>
<span className="badge badge-warning">Running</span>
<span className="badge badge-error">Failed</span>
<span className="badge badge-info">Info</span>
```

**Status Indicators**
```jsx
<span className="status-dot status-dot-active"></span>
<span className="status-dot status-dot-running"></span>
<span className="status-dot status-dot-error"></span>
```

### Alerts

```jsx
<div className="alert alert-success">
  ✓ Job completed successfully
</div>

<div className="alert alert-error">
  ✗ Failed to deploy templates
</div>

<div className="alert alert-warning">
  ⚠ High resource usage detected
</div>
```

### Tables

```jsx
<div className="table-container">
  <table className="table">
    <thead>
      <tr>
        <th>Job</th>
        <th>Status</th>
        <th>Progress</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Community Setup</td>
        <td><span className="badge badge-success">Completed</span></td>
        <td>100%</td>
      </tr>
    </tbody>
  </table>
</div>
```

### Progress Bars

```jsx
<div className="progress-bar">
  <div className="progress-bar-fill" style={{ width: '65%' }}></div>
</div>
```

### Layout Containers

```jsx
<!-- Full-width section -->
<div className="section">
  <h2>Section Title</h2>
  <p>Content</p>
</div>

<!-- Constrained width -->
<div className="container-tight">
  <h2>Narrow column</h2>
</div>

<!-- Wide content -->
<div className="container-wide">
  <p>Full width content</p>
</div>
```

---

## 🎬 Animations

### Fade In
```jsx
<div className="animate-fade-in">
  Content appears smoothly
</div>
```

### Slide Up
```jsx
<div className="animate-slide-up">
  Content slides up from below
</div>
```

### Pulse (for status indicators)
```jsx
<div className="pulse">
  ● Live indicator
</div>
```

---

## 📐 Spacing & Layout

### Standard Spacing Scale
```css
gap-1  /* 0.25rem */
gap-2  /* 0.5rem */
gap-3  /* 0.75rem */
gap-4  /* 1rem */
gap-6  /* 1.5rem */
gap-8  /* 2rem */
gap-12 /* 3rem */
```

### Padding (p-*)
```css
p-2    /* 0.5rem */
p-4    /* 1rem */
p-6    /* 1.5rem */    /* Default card padding */
px-4   /* Horizontal padding only */
py-3   /* Vertical padding only */
```

### Margin (m-*)
```css
m-0    /* No margin */
m-4    /* 1rem margin */
mb-6   /* Bottom margin */
mt-8   /* Top margin */
```

### Flexbox Utilities
```jsx
<!-- Center content -->
<div className="flex-center">Centered</div>

<!-- Space between -->
<div className="flex-between">
  <span>Left</span>
  <span>Right</span>
</div>

<!-- Column layout -->
<div className="flex flex-col gap-4">
  <div>Item 1</div>
  <div>Item 2</div>
</div>
```

---

## 🔄 Responsive Design

### Mobile-First Approach

```jsx
<!-- Default for mobile, then override for larger screens -->
<div className="flex flex-col md:flex-row gap-4">
  <div className="w-full md:w-1/2">Sidebar</div>
  <div className="w-full md:w-1/2">Content</div>
</div>
```

### Hide/Show on Mobile

```jsx
<!-- Show only on desktop -->
<div className="hide-mobile">Desktop only</div>

<!-- Show only on mobile -->
<div className="show-mobile">Mobile only</div>
```

### Breakpoints

```css
sm: 640px
md: 768px
lg: 1024px
xl: 1280px
2xl: 1536px
```

---

## 📋 Migration Guide — From Old to New

### Color Changes

| Old | New | Tailwind Class |
|-----|-----|----------------|
| `ink: '#0f1117'` | `primary-900` | `text-primary-900` |
| `panel: '#181c26'` | `neutral-100` | `bg-neutral-100` |
| `border: '#252a38'` | `neutral-300` | `border-neutral-300` |
| `accent: '#4ade80'` | `success: '#10b981'` | `bg-success` |
| `warn: '#f59e0b'` | `warning: '#f59e0b'` | `bg-warning` |
| `danger: '#f87171'` | `error: '#ef4444'` | `bg-error` |

### Component Examples

**Old (Dark theme):**
```jsx
<div style={{ background: '#181c26', color: '#e2e8f0' }}>
  <button style={{ background: '#4ade80', color: '#0f1117' }}>Click</button>
</div>
```

**New (Modern ALIS theme):**
```jsx
<div className="bg-neutral-100 text-neutral-700">
  <button className="btn-primary">Click</button>
</div>
```

---

## ✅ Best Practices

### Do ✓
- Use semantic color names (`primary`, `accent`, `error`)
- Maintain consistent spacing with Tailwind scales
- Use `.card` and `.btn-*` components for consistency
- Test responsiveness on mobile devices
- Keep text contrast accessible (WCAG AA)

### Don't ✗
- Don't use hardcoded colors (use Tailwind classes)
- Don't mix old and new color systems
- Don't use `inline` styles for layout (use Tailwind)
- Don't create custom components without checking existing ones
- Don't forget focus states for accessibility

---

## 🎯 Accessibility

### Color Contrast
- All text meets WCAG AA standards
- Don't rely on color alone (use icons + text for status)
- Status indicators use multiple cues (color + text + icon)

### Keyboard Navigation
- All interactive elements are keyboard accessible
- Tab order follows logical flow
- Focus states are clearly visible

### Labels & Descriptions
```jsx
<!-- Good: Label associated with input -->
<label htmlFor="email">Email</label>
<input id="email" type="email" />

<!-- Good: Alt text for images -->
<img src="icon.svg" alt="Success indicator" />

<!-- Good: Descriptive button text -->
<button>Save Changes</button>
```

---

## 🚀 Quick Start Examples

### Dashboard Page
```jsx
function Dashboard() {
  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>
      <div className="page-body">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="card">
            <h4>Total Jobs</h4>
            <p className="text-3xl font-bold text-accent-500">42</p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

### Form Example
```jsx
function JobForm() {
  return (
    <form className="card max-w-md">
      <h2>Create New Job</h2>
      
      <div className="input-group mt-6">
        <label className="input-label">Job Name</label>
        <input placeholder="e.g., Community Setup" />
      </div>

      <div className="input-group mt-4">
        <label className="input-label">Template</label>
        <select>
          <option>Select template...</option>
        </select>
      </div>

      <div className="flex gap-3 mt-6">
        <button className="btn-primary flex-1">Create</button>
        <button className="btn-secondary flex-1">Cancel</button>
      </div>
    </form>
  );
}
```

### Status Display
```jsx
function JobStatus({ status }) {
  const badgeClass = {
    completed: 'badge-success',
    running: 'badge-warning',
    failed: 'badge-error',
  }[status];

  return (
    <div className="card">
      <h4 className="flex-between">
        My Job
        <span className={`badge ${badgeClass}`}>{status}</span>
      </h4>
      <div className="progress-bar mt-4">
        <div className="progress-bar-fill" style={{ width: '75%' }}></div>
      </div>
      <p className="text-sm text-muted mt-2">3 of 4 communities completed</p>
    </div>
  );
}
```

---

## 📞 Questions?

For more information:
- **Tailwind CSS:** https://tailwindcss.com/docs
- **Component library:** See `.card`, `.btn-*`, `.badge` classes in `index.css`
- **Color system:** Check `tailwind.config.js` for color definitions

Keep it clean. Keep it simple. 🚀
