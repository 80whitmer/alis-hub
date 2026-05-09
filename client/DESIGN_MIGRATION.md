# Design System Migration Guide

How to update your React components from the old dark theme to the new ALIS-branded modern aesthetic.

---

## 🎯 Quick Summary

**Old System:**
- Dark backgrounds (#0f1117, #181c26)
- Green accent (#4ade80)
- Matrix-like aesthetic
- Inline styles or utility classes

**New System:**
- Light, clean backgrounds (#f9fafb, white)
- Teal accent (#00a896, #26d0ce)
- Professional, inviting aesthetic
- Tailwind classes + design system components

---

## 📝 Step-by-Step Migration

### Step 1: Update Page Layout

**Before:**
```jsx
function Dashboard() {
  return (
    <div style={{ background: '#0f1117', color: '#e2e8f0', minHeight: '100vh' }}>
      <header style={{ borderBottom: '1px solid #252a38', padding: '20px' }}>
        <h1>Dashboard</h1>
      </header>
      <main style={{ padding: '20px' }}>
        {/* content */}
      </main>
    </div>
  );
}
```

**After:**
```jsx
function Dashboard() {
  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>
      <div className="page-body">
        {/* content */}
      </div>
    </div>
  );
}
```

### Step 2: Update Card Components

**Before:**
```jsx
<div style={{
  background: '#181c26',
  border: '1px solid #252a38',
  borderRadius: '8px',
  padding: '20px',
}}>
  <h3 style={{ color: '#e2e8f0' }}>Card Title</h3>
</div>
```

**After:**
```jsx
<div className="card">
  <h3>Card Title</h3>
</div>
```

### Step 3: Update Buttons

**Before:**
```jsx
<button style={{
  background: '#4ade80',
  color: '#0f1117',
  padding: '8px 16px',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
}}>
  Save
</button>
```

**After:**
```jsx
<button className="btn-primary">Save</button>
```

**Button Variants:**
```jsx
{/* Primary - for main actions */}
<button className="btn-primary">Create Job</button>

{/* Secondary - for secondary actions */}
<button className="btn-secondary">Cancel</button>

{/* Accent - for important CTAs */}
<button className="btn-accent">Deploy</button>

{/* Danger - for destructive actions */}
<button className="btn-danger">Delete</button>

{/* Ghost - minimal style */}
<button className="btn-ghost">Learn More</button>

{/* Size variants */}
<button className="btn-primary btn-sm">Small</button>
<button className="btn-primary btn-lg">Large</button>
```

### Step 4: Update Form Elements

**Before:**
```jsx
<div style={{ marginBottom: '16px' }}>
  <label style={{ display: 'block', marginBottom: '8px', color: '#e2e8f0' }}>
    Email
  </label>
  <input
    type="email"
    style={{
      width: '100%',
      padding: '8px 12px',
      background: '#252a38',
      border: '1px solid #4a5068',
      color: '#e2e8f0',
      borderRadius: '6px',
    }}
  />
</div>
```

**After:**
```jsx
<div className="input-group">
  <label className="input-label">Email</label>
  <input type="email" placeholder="your@email.com" />
  <p className="input-help">Your work email address</p>
</div>
```

### Step 5: Update Status Indicators

**Before:**
```jsx
<div style={{
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  padding: '4px 12px',
  background: status === 'running' ? '#f59e0b' : '#4ade80',
  color: '#0f1117',
  borderRadius: '20px',
  fontSize: '12px',
  fontWeight: 500,
}}>
  {status}
</div>
```

**After:**
```jsx
{/* Status Badge */}
<span className={`badge badge-${status}`}>
  {status}
</span>

{/* Status Indicator Dot */}
<span className={`status-dot status-dot-${status}`}></span>

{/* Examples */}
<span className="badge badge-success">Completed</span>
<span className="badge badge-warning">Running</span>
<span className="badge badge-error">Failed</span>
<span className="status-dot status-dot-active"></span>
```

### Step 6: Update Tables

**Before:**
```jsx
<table style={{
  width: '100%',
  borderCollapse: 'collapse',
  color: '#e2e8f0',
}}>
  <thead style={{ background: '#252a38', borderBottom: '1px solid #4a5068' }}>
    <tr>
      <th style={{ padding: '12px', textAlign: 'left' }}>Name</th>
      <th style={{ padding: '12px', textAlign: 'left' }}>Status</th>
    </tr>
  </thead>
  <tbody>
    {/* rows */}
  </tbody>
</table>
```

**After:**
```jsx
<div className="table-container">
  <table className="table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      {/* rows */}
    </tbody>
  </table>
</div>
```

### Step 7: Update Alerts/Messages

**Before:**
```jsx
<div style={{
  background: status === 'error' ? '#f87171' : '#4ade80',
  color: '#0f1117',
  padding: '12px 16px',
  borderRadius: '6px',
  marginBottom: '16px',
}}>
  {message}
</div>
```

**After:**
```jsx
{/* Success alert */}
<div className="alert alert-success">
  ✓ Job completed successfully
</div>

{/* Error alert */}
<div className="alert alert-error">
  ✗ Something went wrong
</div>

{/* Warning alert */}
<div className="alert alert-warning">
  ⚠ Please review this action
</div>

{/* Info alert */}
<div className="alert alert-info">
  ℹ New features available
</div>
```

### Step 8: Update Progress Bars

**Before:**
```jsx
<div style={{
  width: '100%',
  height: '4px',
  background: '#4a5068',
  borderRadius: '2px',
  overflow: 'hidden',
}}>
  <div
    style={{
      width: `${progress}%`,
      height: '100%',
      background: '#4ade80',
      transition: 'width 0.3s ease',
    }}
  />
</div>
```

**After:**
```jsx
<div className="progress-bar">
  <div 
    className="progress-bar-fill" 
    style={{ width: `${progress}%` }}
  ></div>
</div>
```

### Step 9: Update Color References

**Text Colors:**
```jsx
{/* Old: style={{ color: '#e2e8f0' }} */}
{/* New: */}
<p className="text-neutral-700">Body text</p>
<p className="text-neutral-500">Secondary text</p>
<p className="text-neutral-400">Muted text</p>
```

**Background Colors:**
```jsx
{/* Old: style={{ background: '#181c26' }} */}
{/* New: */}
<div className="bg-white">Default</div>
<div className="bg-neutral-100">Light</div>
<div className="bg-neutral-50">Lighter</div>
```

**Border Colors:**
```jsx
{/* Old: style={{ borderColor: '#252a38' }} */}
{/* New: */}
<div className="border border-neutral-300">Border</div>
<div className="border-t border-neutral-200">Divider</div>
```

### Step 10: Update Spacing

**Before:**
```jsx
<div style={{ padding: '20px', marginBottom: '16px', gap: '12px' }}>
```

**After:**
```jsx
<div className="p-6 mb-4 gap-3">
```

**Common Spacing:**
```jsx
p-4          {/* 1rem padding */}
p-6          {/* 1.5rem padding - default card padding */}
m-4          {/* 1rem margin */}
gap-3        {/* 0.75rem gap between flex/grid items */}
gap-6        {/* 1.5rem gap */}
mt-6         {/* margin-top */}
mb-4         {/* margin-bottom */}
px-4         {/* horizontal padding */}
py-3         {/* vertical padding */}
```

---

## 🔄 Component Checklist

As you update components, check off each section:

### Dashboard
- [ ] Page layout (page, page-header, page-body)
- [ ] Job cards (`.card` class)
- [ ] Status badges (`.badge` classes)
- [ ] Stats counters (text-3xl, font-bold)
- [ ] Action buttons (`.btn-*` classes)

### Job List
- [ ] Table styling (`.table` classes)
- [ ] Row hover effects
- [ ] Status indicators
- [ ] Action buttons
- [ ] Pagination controls

### Job Detail
- [ ] Card components
- [ ] Progress bars
- [ ] Status display
- [ ] Timeline/history
- [ ] Action buttons

### Forms
- [ ] Input groups (`.input-group`)
- [ ] Labels (`.input-label`)
- [ ] Help text (`.input-help`)
- [ ] Error messages (`.input-error`)
- [ ] Form buttons

### Modals/Dialogs
- [ ] Modal backdrop (`.modal-backdrop`)
- [ ] Modal container (`.modal-content`)
- [ ] Buttons and forms inside
- [ ] Close button styling

### Alerts/Notifications
- [ ] Alert boxes (`.alert` classes)
- [ ] Status messages
- [ ] Error handling
- [ ] Success confirmations

---

## 📊 Before/After Comparison

### Dashboard Example

**Before:**
```jsx
function Dashboard() {
  return (
    <div style={{ background: '#0f1117', minHeight: '100vh', color: '#e2e8f0' }}>
      <div style={{ background: '#181c26', padding: '20px', borderBottom: '1px solid #252a38' }}>
        <h1>Dashboard</h1>
      </div>
      <div style={{ padding: '20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {/* Cards */}
          <div style={{ background: '#181c26', padding: '20px', borderRadius: '8px', border: '1px solid #252a38' }}>
            <h3>Total Jobs</h3>
            <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#4ade80' }}>42</p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**After:**
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
            <h3>Total Jobs</h3>
            <p className="text-3xl font-bold text-accent-500">42</p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

## 🎨 Color Mapping Reference

| Usage | Old | New Class | New Color |
|-------|-----|-----------|-----------|
| Page background | #0f1117 | `bg-neutral-50` | #f9fafb |
| Card background | #181c26 | `bg-white` | #ffffff |
| Borders | #252a38 | `border-neutral-300` | #d1d5db |
| Primary text | #e2e8f0 | `text-neutral-700` | #374151 |
| Secondary text | #4a5068 | `text-neutral-500` | #6b7280 |
| Accent (green) | #4ade80 | `text-accent-500` | #00a896 |
| Running state | #f59e0b | `bg-warning` | #f59e0b |
| Failed state | #f87171 | `bg-error` | #ef4444 |
| Primary (navy) | N/A | `text-primary-600` | #1a3a52 |

---

## 🚀 Migration Order

Recommended order to migrate components:

1. **Layout components** (page, page-header, page-body) — Foundation
2. **Cards** (`.card` class) — Used everywhere
3. **Buttons** (`.btn-*` classes) — Used everywhere
4. **Forms** (input groups, labels) — Frequent use
5. **Tables** (`.table` class) — If used
6. **Badges & Status** (`.badge`, `.status-dot`) — For status display
7. **Alerts** (`.alert` classes) — For messages
8. **Progress bars** (`.progress-bar`) — For progress display
9. **Color updates** — Final pass on any remaining colors
10. **Spacing adjustments** — Fine-tune padding/margin

---

## ✅ Testing Checklist

After migrating each component:

- [ ] Component displays correctly
- [ ] Colors match design system
- [ ] Spacing looks balanced
- [ ] Buttons have hover states
- [ ] Text is readable (good contrast)
- [ ] Responsive layout works (mobile, tablet, desktop)
- [ ] No inline styles remaining
- [ ] Uses Tailwind classes consistently
- [ ] Status indicators are clear
- [ ] Animations are smooth

---

## 💡 Tips

### Find & Replace (IDE)

Use your editor's find & replace to speed up migration:

```
Find:    style={{
Replace: className="

Find:    background: '#0f1117'
Replace: (remove line - use page class)

Find:    borderRadius: '8px'
Replace: (remove - use rounded-lg)
```

### Batch Migration Script

Consider writing a script to help with common replacements:

```jsx
// Example: Replace all card divs
// Find: style={{ background: '#181c26', ...
// Replace: className="card"
```

### Gradual Migration

You don't have to do everything at once:
1. Update layout first
2. Update components next
3. Update colors last
4. The old and new systems can coexist temporarily

---

## 📚 Resources

- **Tailwind Docs:** https://tailwindcss.com/docs
- **Design System:** See `DESIGN_SYSTEM.md`
- **Color Reference:** See `tailwind.config.js`

Good luck with the migration! 🚀
