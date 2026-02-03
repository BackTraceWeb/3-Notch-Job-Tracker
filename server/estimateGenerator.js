const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generate QuickBooks-style Estimate PDF
 * @param {Object} job - Job data from database
 * @param {Array} lineItems - Array of line items from estimate_items table
 * @param {Object} user - User data (name, email, phone)
 * @param {string} estimateNumber - Estimate number (e.g., "EST-1001")
 * @param {string} outputPath - Path to save PDF
 * @returns {Promise} - Resolves when PDF is generated
 */
function generateEstimate(job, lineItems, user, estimateNumber, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      // Create PDF document
      const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
      const stream = fs.createWriteStream(outputPath);

      doc.pipe(stream);

      // Colors (3 Notch branding)
      const goldColor = '#b8ae97';
      const darkColor = '#191917';
      const grayColor = '#666666';

      // Add 3 Notch Logo (top left)
      const logoPath = path.join(__dirname, '../public/logo-transparent.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 50, 45, { width: 120 });
      }

      // Company info (top right)
      doc.fontSize(10)
         .fillColor(darkColor)
         .text('3 Notch Cabinet Co', 400, 50, { align: 'right' })
         .text('1213 Dr MLK Jr Expy', 400, 65, { align: 'right' })
         .text('Andalusia, AL 36420', 400, 80, { align: 'right' })
         .text('Phone: (334) 981-0002', 400, 95, { align: 'right' });

      // User contact info (below company info) - Make it noticeable
      if (user && user.full_name) {
        doc.fontSize(11)
           .fillColor(goldColor)
           .font('Helvetica-Bold')
           .text('Contact: ' + user.full_name, 400, 115, { align: 'right' })
           .font('Helvetica')
           .fontSize(10)
           .fillColor(darkColor);
        if (user.email) {
          doc.text(user.email, 400, 129, { align: 'right' });
        }
        if (user.phone) {
          doc.text(user.phone, 400, 142, { align: 'right' });
        }
      }

      // Estimate Title (centered to avoid logo)
      doc.fontSize(24)
         .fillColor(goldColor)
         .text('ESTIMATE', 50, 160, { align: 'center', width: 512 });

      // Estimate info box
      const estimateBoxY = 200;
      doc.fontSize(10)
         .fillColor(darkColor)
         .text(`Estimate #: ${estimateNumber}`, 50, estimateBoxY)
         .text(`Date: ${new Date().toLocaleDateString()}`, 50, estimateBoxY + 15)
         .text(`Valid Until: ${getValidUntilDate()}`, 50, estimateBoxY + 30);

      // Bill To section
      const billToY = estimateBoxY + 60;
      doc.fontSize(12)
         .fillColor(goldColor)
         .text('BILL TO:', 50, billToY);

      doc.fontSize(10)
         .fillColor(darkColor)
         .text(job.job_name || 'Customer Name', 50, billToY + 20)
         .text(job.job_address || '', 50, billToY + 35)
         .text(job.job_email || '', 50, billToY + 50);

      // Table header
      const tableTop = billToY + 100;
      const col1X = 50;   // Description
      const col2X = 320;  // Quantity
      const col3X = 390;  // Rate
      const col4X = 480;  // Amount

      // Table header background
      doc.rect(col1X, tableTop, 512, 25)
         .fillAndStroke(goldColor, darkColor);

      // Table header text
      doc.fontSize(10)
         .fillColor('#FFFFFF')
         .text('Description', col1X + 10, tableTop + 8)
         .text('Qty', col2X + 5, tableTop + 8)
         .text('Rate', col3X + 5, tableTop + 8)
         .text('Amount', col4X + 5, tableTop + 8);

      // Table rows
      let currentY = tableTop + 35;
      const lineHeight = 25;

      // Use provided line items or fallback to job data
      let items = lineItems;
      if (!items || items.length === 0) {
        items = parseItemsNeeded(job);
      }

      let subtotal = 0;

      items.forEach((item, index) => {
        const amount = item.amount || (item.quantity * item.rate);
        subtotal += amount;

        // Alternate row background
        if (index % 2 === 0) {
          doc.rect(col1X, currentY - 5, 512, lineHeight)
             .fillAndStroke('#f5f5f5', '#dddddd');
        }

        doc.fillColor(darkColor)
           .fontSize(9)
           .text(item.description, col1X + 10, currentY, { width: 250 })
           .text(item.quantity.toString(), col2X + 5, currentY)
           .text(`$${item.rate.toFixed(2)}`, col3X + 5, currentY)
           .text(`$${amount.toFixed(2)}`, col4X + 5, currentY);

        currentY += lineHeight;
      });

      // Totals section
      currentY += 20;
      const totalsX = 400;

      doc.fontSize(10)
         .fillColor(darkColor)
         .text('Subtotal:', totalsX, currentY)
         .text(`$${subtotal.toFixed(2)}`, totalsX + 90, currentY, { align: 'right' });

      currentY += 20;
      const tax = 0; // Add tax calculation if needed
      doc.text('Tax:', totalsX, currentY)
         .text(`$${tax.toFixed(2)}`, totalsX + 90, currentY, { align: 'right' });

      currentY += 25;
      doc.fontSize(14)
         .fillColor(goldColor)
         .rect(totalsX - 10, currentY - 8, 172, 35)
         .fillAndStroke('#f0f0f0', goldColor)
         .fillColor(darkColor)
         .font('Helvetica-Bold')
         .text('Total:', totalsX, currentY + 2)
         .text(`$${(subtotal + tax).toFixed(2)}`, totalsX + 85, currentY + 2, { align: 'right' })
         .font('Helvetica');

      // Terms & Conditions
      currentY += 60;
      doc.fontSize(10)
         .fillColor(goldColor)
         .text('Terms & Conditions:', 50, currentY);

      currentY += 20;
      doc.fontSize(8)
         .fillColor(grayColor)
         .text('• 50% deposit required to begin work', 50, currentY)
         .text('• Balance due upon completion', 50, currentY + 12)
         .text('• Estimate valid for 30 days', 50, currentY + 24)
         .text('• Pricing based on square footage', 50, currentY + 36)
         .text('• Custom cabinet work - measurements must be verified on-site', 50, currentY + 48);

      // Footer
      doc.fontSize(8)
         .fillColor(grayColor)
         .text('Thank you for your business!', 50, 720, { align: 'center', width: 512 });

      // Finalize PDF
      doc.end();

      stream.on('finish', () => {
        resolve(outputPath);
      });

      stream.on('error', (err) => {
        reject(err);
      });

    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Parse items_needed string into structured line items
 * @param {Object} job - Job data
 * @returns {Array} - Array of {description, quantity, rate}
 */
function parseItemsNeeded(job) {
  const items = [];

  // If items_needed has structured data, parse it
  // For now, create a basic item from job data
  if (job.items_needed) {
    items.push({
      description: job.items_needed,
      quantity: 1,
      rate: job.quoted_price || job.material_cost || 0
    });
  }

  // Add cabinet color as line item if specified
  if (job.job_color && job.job_color !== 'Unfinished') {
    items.push({
      description: `Cabinet Finish: ${job.job_color}`,
      quantity: 1,
      rate: 0 // Included in main price
    });
  }

  // If no items, add a default placeholder
  if (items.length === 0) {
    items.push({
      description: 'Custom Cabinet Work',
      quantity: 1,
      rate: job.quoted_price || 0
    });
  }

  return items;
}

/**
 * Calculate date 30 days from now
 * @returns {string} - Formatted date
 */
function getValidUntilDate() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toLocaleDateString();
}

module.exports = { generateEstimate };
