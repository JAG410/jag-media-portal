// ============================================================
// JAG Media Upload — Google Apps Script Backend (v2)
// ============================================================
// CHANGES IN V2:
// - Multi-file upload support (all files in one request)
// - Creates date+description subfolder in Social Staged
// - Uploader name tracked in metadata
// - Draft caption generated in D12 voice
// - Email includes all photos as attachments + draft caption
// ============================================================
// SETUP / REDEPLOYMENT:
// 1. Go to https://script.google.com
// 2. Open the existing JAG Media Upload project
// 3. Replace ALL code with this file
// 4. Click "Deploy" > "Manage deployments"
// 5. Click the pencil icon on the active deployment
// 6. Set "Version" to "New version"
// 7. Click "Deploy"
// ============================================================

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // Get or create the target folder: D12 Pipeline/Social Staged
    var socialFolder = getOrCreateFolder('D12 Pipeline/Social Staged');

    // Create a subfolder for this batch: YYYY-MM-DD_Description
    var timestamp = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
    var timeHM = Utilities.formatDate(new Date(), 'America/New_York', 'HH-mm');
    var descSlug = (data.description || 'upload').substring(0, 40)
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase();
    var subfolderName = timestamp + '_' + descSlug;
    var batchFolder = socialFolder.createFolder(subfolderName);

    // Upload all files into the subfolder
    var uploadedFiles = [];
    var attachments = [];
    var files = data.files || [];

    for (var i = 0; i < files.length; i++) {
      var fileData = files[i];
      var blob = Utilities.newBlob(
        Utilities.base64Decode(fileData.data),
        fileData.mimeType,
        fileData.name
      );
      batchFolder.createFile(blob);
      uploadedFiles.push(fileData.name);

      // Attach images to the email (skip videos — too large)
      if (fileData.mimeType && fileData.mimeType.indexOf('image/') === 0) {
        try {
          var attachBlob = Utilities.newBlob(
            Utilities.base64Decode(fileData.data),
            fileData.mimeType,
            fileData.name
          );
          // Only attach if under 5MB to avoid email size limits
          if (attachBlob.getBytes().length < 5 * 1024 * 1024) {
            attachments.push(attachBlob);
          }
        } catch (attachErr) {
          // Skip attachment on error, still upload to Drive
        }
      }
    }

    // Create metadata text file in the subfolder
    var metaContent = 'Upload Batch: ' + subfolderName + '\n'
      + 'Uploaded by: ' + (data.uploaderName || 'Unknown') + '\n'
      + 'Time: ' + timeHM + '\n'
      + 'Files: ' + uploadedFiles.join(', ') + '\n'
      + 'File count: ' + files.length + '\n'
      + '\n--- Context ---\n'
      + 'Description: ' + (data.description || 'None') + '\n'
      + 'VIPs/Stakeholders: ' + (data.vips || 'None') + '\n'
      + 'Event/Location: ' + (data.event || 'None') + '\n'
      + 'Notes: ' + (data.notes || 'None') + '\n';
    batchFolder.createFile(subfolderName + '_info.txt', metaContent, 'text/plain');

    // Generate draft caption in D12 voice
    var draftCaption = generateCaption(data);

    // Send email notification with attachments and draft caption
    var emailSubject = 'JAG Media Upload — ' + (data.description || 'New Upload')
      + ' (' + files.length + ' file' + (files.length === 1 ? '' : 's') + ')';

    var emailBody = 'New media uploaded to Social Staged\n'
      + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'
      + 'Uploaded by: ' + (data.uploaderName || 'Unknown') + '\n'
      + 'Files: ' + files.length + ' (' + uploadedFiles.join(', ') + ')\n'
      + 'Description: ' + (data.description || 'None') + '\n'
      + 'VIPs: ' + (data.vips || 'None') + '\n'
      + 'Event/Location: ' + (data.event || 'None') + '\n'
      + 'Notes: ' + (data.notes || 'None') + '\n\n'
      + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
      + 'DRAFT CAPTION (edit as needed):\n'
      + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'
      + draftCaption + '\n\n'
      + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
      + 'View folder in Drive: ' + batchFolder.getUrl() + '\n'
      + 'Uploaded: ' + timestamp + ' ' + timeHM + '\n';

    var emailOptions = {};
    if (attachments.length > 0) {
      emailOptions.attachments = attachments;
    }

    GmailApp.sendEmail(
      'johnsonadvisorygrp@gmail.com',
      emailSubject,
      emailBody,
      emailOptions
    );

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, folder: subfolderName, fileCount: files.length }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Generate a draft Instagram caption in the D12 / @councilmanjjones voice.
 * Uses the context fields from the upload form.
 */
function generateCaption(data) {
  var desc = data.description || '';
  var vips = data.vips || '';
  var eventLoc = data.event || '';
  var notes = data.notes || '';

  // Build the hook line
  var hook = '';
  if (desc) {
    // Convert description to a natural opening
    hook = 'We ' + lowerFirst(desc);
    // Add period if it doesn't end with punctuation
    if (!/[.!?]$/.test(hook)) hook += '.';
  } else {
    hook = 'Great day out in the community.';
  }

  // Build context paragraph
  var context = '';
  if (vips && eventLoc) {
    context = 'We were joined by ' + vips + ' at ' + eventLoc + '.';
  } else if (vips) {
    context = 'We were joined by ' + vips + '.';
  } else if (eventLoc) {
    context = 'We were out at ' + eventLoc + '.';
  }

  // Add notes if present
  if (notes) {
    context += (context ? ' ' : '') + notes;
    if (!/[.!?]$/.test(context)) context += '.';
  }

  // Build significance line
  var significance = 'Thank you to everyone who came out and continues to invest in our community.';

  // Build hashtags
  var hashtags = ['#District12', '#Baltimore'];
  if (eventLoc) {
    if (/east/i.test(eventLoc)) hashtags.push('#EastBaltimore');
    if (/city hall/i.test(eventLoc)) hashtags.push('#BaltimoreCityCouncil');
  }
  hashtags.push('#ExploreDistrict12');

  // Assemble caption
  var parts = [hook];
  if (context) parts.push(context);
  parts.push(significance);
  parts.push(hashtags.join(' '));

  return parts.join('\n\n');
}

/**
 * Lowercase the first character of a string.
 */
function lowerFirst(str) {
  if (!str) return str;
  // Don't lowercase if it starts with a proper noun indicator (capital after space)
  // Just lowercase the very first character
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function getOrCreateFolder(path) {
  var parts = path.split('/');
  var parent = DriveApp.getRootFolder();
  for (var i = 0; i < parts.length; i++) {
    var folders = parent.getFoldersByName(parts[i]);
    if (folders.hasNext()) {
      parent = folders.next();
    } else {
      parent = parent.createFolder(parts[i]);
    }
  }
  return parent;
}
