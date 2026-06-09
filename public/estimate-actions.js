// Estimate Actions Handler

let currentEstimateJobId = null;
let currentEstimatePath = null;

// ========== INLINE ESTIMATE ACTIONS (In Job Modal) ==========

// Show/hide inline estimate actions based on job state
function updateInlineEstimateActions(job) {
  const estimateActionsSection = document.getElementById('estimate-actions-section');
  if (!estimateActionsSection) return;

  // Show section if we have a saved job (has an ID)
  if (job && job.id) {
    estimateActionsSection.style.display = 'block';
    currentEstimateJobId = job.id;
    currentEstimatePath = job.estimate_pdf_path;

    // If estimate exists, show print/email buttons
    if (job.estimate_pdf_path && job.estimate_number) {
      document.getElementById('estimate-pdf-actions').style.display = 'block';
      document.getElementById('inline-estimate-number').textContent = job.estimate_number;
    } else {
      document.getElementById('estimate-pdf-actions').style.display = 'none';
      document.getElementById('inline-estimate-number').textContent = '-';
    }
  } else {
    estimateActionsSection.style.display = 'none';
  }
}

// Generate estimate inline
document.getElementById('generate-estimate-inline-btn')?.addEventListener('click', async () => {
  let jobId = document.getElementById('job-id').value;

  const statusDiv = document.getElementById('inline-estimate-status');
  const statusText = document.getElementById('inline-estimate-status-text');

  statusDiv.style.display = 'block';

  // If no job ID, we need to save the job first
  if (!jobId) {
    statusText.textContent = 'Saving job first...';

    // Trigger the form save
    const saveResult = await saveJobAndReturnId();
    if (!saveResult || !saveResult.success) {
      statusText.textContent = '❌ Please fill in required fields and save the job first';
      return;
    }

    jobId = saveResult.jobId;
    document.getElementById('job-id').value = jobId;
    currentEstimateJobId = jobId;
  }

  statusText.textContent = 'Saving line items...';

  // Save line items to database before generating PDF
  try {
    const lineItems = window.estimateHandler ? window.estimateHandler.getLineItems() : [];
    if (lineItems.length > 0) {
      await fetch(`/api/jobs/${jobId}/estimate-items/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: lineItems })
      });
    }
  } catch (e) {
    console.error('Error saving line items:', e);
  }

  statusText.textContent = 'Generating estimate PDF...';

  try {
    const response = await fetch(`/api/jobs/${jobId}/generate-estimate`, {
      method: 'POST'
    });

    const data = await response.json();

    if (data.success) {
      statusText.textContent = `✅ Estimate ${data.estimateNumber} generated successfully!`;
      currentEstimatePath = data.pdfUrl;

      // Update display
      document.getElementById('inline-estimate-number').textContent = data.estimateNumber;
      document.getElementById('estimate-pdf-actions').style.display = 'block';

      // Auto-open print dialog after 1 second
      setTimeout(() => {
        printEstimateInline();
      }, 1000);
    } else {
      statusText.textContent = '❌ Error generating estimate';
    }
  } catch (error) {
    console.error('Error generating estimate:', error);
    statusText.textContent = '❌ Error generating estimate';
  }
});

// Helper function to save job and return ID
async function saveJobAndReturnId() {
  // Get form data
  const customerId = document.getElementById('customer-select')?.value;
  const jobAddress = document.getElementById('job-address')?.value;
  const jobEmail = document.getElementById('job-email')?.value;
  const jobColor = document.getElementById('job-color')?.value;
  const stage = document.getElementById('stage')?.value;
  const itemsNeeded = document.getElementById('items-needed')?.value;
  const installDate = document.getElementById('install-date')?.value;
  const completionDate = document.getElementById('completion-date')?.value;
  const completionPercentage = document.getElementById('completion-percentage')?.value;

  // Get line items
  const lineItems = window.estimateHandler ? window.estimateHandler.getLineItems() : [];

  // Get material cost and quoted price
  const materialCost = document.getElementById('material-cost-input')?.value || 0;
  const quotedPrice = document.getElementById('quoted-price')?.value || 0;

  // Validate required fields
  if (!customerId) {
    alert('Please select a customer');
    return { success: false };
  }

  const jobData = {
    customer_id: customerId,
    job_address: jobAddress,
    job_email: jobEmail,
    job_color: jobColor,
    stage: stage,
    items_needed: itemsNeeded,
    install_date: installDate,
    completion_date: completionDate,
    completion_percentage: completionPercentage,
    material_cost: materialCost,
    quoted_price: quotedPrice,
    line_items: lineItems
  };

  try {
    const response = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jobData)
    });

    const data = await response.json();
    if (data.id) {
      return { success: true, jobId: data.id };
    } else {
      return { success: false };
    }
  } catch (error) {
    console.error('Error saving job:', error);
    return { success: false };
  }
}

// Print estimate inline
document.getElementById('print-estimate-inline-btn')?.addEventListener('click', () => {
  printEstimateInline();
});

function printEstimateInline() {
  if (!currentEstimatePath) {
    alert('No estimate available');
    return;
  }

  // Open PDF in new window and print
  const printWindow = window.open(currentEstimatePath, '_blank');

  if (printWindow) {
    // Wait for PDF to load, then print
    printWindow.onload = function() {
      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 1000);
    };

    // Fallback in case onload doesn't fire (for PDFs)
    setTimeout(() => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch (e) {
        console.error('Print error:', e);
      }
    }, 2000);
  } else {
    alert('Please allow pop-ups to print the estimate.');
  }
}

// Email estimate inline
document.getElementById('email-estimate-inline-btn')?.addEventListener('click', async () => {
  if (!currentEstimatePath) {
    alert('No estimate available');
    return;
  }

  const jobId = document.getElementById('job-id').value;

  // Get job data from the form fields instead of fetching
  const customerEmail = document.getElementById('job-email')?.value || '';
  const customerName = document.getElementById('job-name')?.value || 'Customer';
  const estimateNumber = document.getElementById('inline-estimate-number')?.textContent || 'EST';

  try {
    // First, download the PDF automatically
    const link = document.createElement('a');
    link.href = currentEstimatePath;
    link.download = `Estimate-${estimateNumber}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Wait a moment for download to start
    await new Promise(resolve => setTimeout(resolve, 500));

    const fullPdfUrl = window.location.origin + currentEstimatePath;

    const subject = encodeURIComponent(`Estimate ${estimateNumber} from 3 Notch Cabinet Co`);
    const body = encodeURIComponent(
      `Dear ${customerName},\n\n` +
      `Please find your estimate attached.\n\n` +
      `View online here: ${fullPdfUrl}\n\n` +
      `If you have any questions, please don't hesitate to contact us.\n\n` +
      `Thank you,\n` +
      `3 Notch Cabinet Co\n` +
      `(334) 981-0002`
    );

    window.location.href = `mailto:${customerEmail}?subject=${subject}&body=${body}`;

    const statusDiv = document.getElementById('inline-estimate-status');
    const statusText = document.getElementById('inline-estimate-status-text');
    statusDiv.style.display = 'block';
    statusText.textContent = '📧 PDF downloaded! Opening Outlook - attach the file from your Downloads folder.';
  } catch (error) {
    console.error('Error preparing email:', error);
    alert('Error preparing email: ' + error.message);
  }
});

// Export for use in app.js
window.inlineEstimateActions = {
  updateInlineEstimateActions
};

// ========== MODAL ESTIMATE ACTIONS (Separate Modal) ==========

// Show/hide estimate actions button based on job stage
function updateEstimateActionsButton(job) {
  const estimateActionsBtn = document.getElementById('estimate-actions-btn');
  if (!estimateActionsBtn) return;

  // Show button if job is in Quote/Estimate stage or has an estimate
  if (job && (job.stage === 'Quote/Estimate' || job.estimate_pdf_path)) {
    estimateActionsBtn.style.display = 'inline-block';
  } else {
    estimateActionsBtn.style.display = 'none';
  }
}

// Open estimate actions modal
document.getElementById('estimate-actions-btn')?.addEventListener('click', () => {
  const jobId = document.getElementById('job-id').value;
  if (!jobId) {
    alert('Please save the job first');
    return;
  }

  // Fetch job details to get estimate info
  fetch(`/api/jobs/${jobId}`)
    .then(res => res.json())
    .then(job => {
      currentEstimateJobId = job.id;
      currentEstimatePath = job.estimate_pdf_path;

      document.getElementById('estimate-job-id').value = job.id;
      document.getElementById('estimate-display-number').textContent = job.estimate_number || 'Not Generated';

      // Show/hide buttons based on whether estimate exists
      const hasEstimate = job.estimate_pdf_path;
      document.getElementById('generate-estimate-btn').style.display = 'block';
      document.getElementById('print-estimate-btn').style.display = hasEstimate ? 'block' : 'none';
      document.getElementById('email-estimate-btn').style.display = hasEstimate ? 'block' : 'none';
      document.getElementById('download-estimate-btn').style.display = hasEstimate ? 'block' : 'none';

      document.getElementById('estimate-actions-modal').classList.add('show');
    })
    .catch(err => {
      console.error('Error fetching job:', err);
      alert('Error loading job details');
    });
});

// Close estimate actions modal
document.getElementById('close-estimate-actions')?.addEventListener('click', () => {
  document.getElementById('estimate-actions-modal').classList.remove('show');
});

// Close modal on background click
document.getElementById('estimate-actions-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'estimate-actions-modal') {
    document.getElementById('estimate-actions-modal').classList.remove('show');
  }
});

// Generate estimate
document.getElementById('generate-estimate-btn')?.addEventListener('click', async () => {
  const jobId = document.getElementById('estimate-job-id').value;
  if (!jobId) return;

  const statusDiv = document.getElementById('estimate-status');
  const statusText = document.getElementById('estimate-status-text');

  statusDiv.style.display = 'block';
  statusText.textContent = 'Generating estimate PDF...';

  try {
    const response = await fetch(`/api/jobs/${jobId}/generate-estimate`, {
      method: 'POST'
    });

    const data = await response.json();

    if (data.success) {
      statusText.textContent = `✅ Estimate ${data.estimateNumber} generated successfully!`;
      currentEstimatePath = data.pdfUrl;

      // Update display
      document.getElementById('estimate-display-number').textContent = data.estimateNumber;

      // Show action buttons
      document.getElementById('print-estimate-btn').style.display = 'block';
      document.getElementById('email-estimate-btn').style.display = 'block';
      document.getElementById('download-estimate-btn').style.display = 'block';

      // Auto-open print dialog after 1 second
      setTimeout(() => {
        printEstimate();
      }, 1000);
    } else {
      statusText.textContent = '❌ Error generating estimate';
    }
  } catch (error) {
    console.error('Error generating estimate:', error);
    statusText.textContent = '❌ Error generating estimate';
  }
});

// Print estimate
document.getElementById('print-estimate-btn')?.addEventListener('click', () => {
  printEstimate();
});

function printEstimate() {
  if (!currentEstimatePath) {
    alert('No estimate available');
    return;
  }

  // Open PDF in new window for printing
  const printWindow = window.open(currentEstimatePath, '_blank');
  if (printWindow) {
    printWindow.onload = function() {
      printWindow.print();
    };
  }
}

// Email estimate via Outlook
document.getElementById('email-estimate-btn')?.addEventListener('click', async () => {
  if (!currentEstimatePath) {
    alert('No estimate available');
    return;
  }

  const jobId = document.getElementById('estimate-job-id').value;

  try {
    // Get job details for email
    const response = await fetch(`/api/jobs/${jobId}`);
    const job = await response.json();

    const customerEmail = job.job_email || '';
    const customerName = job.job_name || 'Customer';
    const estimateNumber = job.estimate_number || 'EST';

    // Get full URL for the estimate PDF
    const fullPdfUrl = window.location.origin + currentEstimatePath;

    // Create Outlook mailto link
    const subject = encodeURIComponent(`Estimate ${estimateNumber} from 3 Notch Cabinet Co`);
    const body = encodeURIComponent(
      `Dear ${customerName},\n\n` +
      `Please find your estimate attached or view it here:\n${fullPdfUrl}\n\n` +
      `If you have any questions, please don't hesitate to contact us.\n\n` +
      `Thank you,\n` +
      `3 Notch Cabinet Co\n` +
      `(334) 981-0002`
    );

    // Open Outlook with pre-filled email
    window.location.href = `mailto:${customerEmail}?subject=${subject}&body=${body}`;

    // Show status
    const statusDiv = document.getElementById('estimate-status');
    const statusText = document.getElementById('estimate-status-text');
    statusDiv.style.display = 'block';
    statusText.textContent = '📧 Opening Outlook... You can attach the PDF from Downloads.';
  } catch (error) {
    console.error('Error preparing email:', error);
    alert('Error preparing email');
  }
});

// Download estimate
document.getElementById('download-estimate-btn')?.addEventListener('click', () => {
  if (!currentEstimatePath) {
    alert('No estimate available');
    return;
  }

  // Download the PDF
  window.open(currentEstimatePath, '_blank');
});

// Export function for use in app.js
window.estimateActions = {
  updateEstimateActionsButton
};
