// ============================================================
// JAG Media Upload -Google Apps Script Backend (v3)
// ============================================================
// CHANGES IN V3:
// - Chunked upload: each file sent individually to avoid payload limits
// - Step 1: "init" action creates subfolder, returns folderId
// - Step 2: "file" action uploads one file to that folder
// - Step 3: "finish" action writes metadata + sends email
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
    var action = data.action || 'legacy';

    // ---- STEP 1: INIT -create subfolder, return folderId ----
    if (action === 'init') {
      var socialFolder = getOrCreateFolder('D12 Pipeline/Social Staged');
      var timestamp = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
      var descSlug = (data.description || 'upload').substring(0, 40)
        .replace(/[^a-zA-Z0-9 ]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase();
      var subfolderName = timestamp + '_' + descSlug;
      var batchFolder = socialFolder.createFolder(subfolderName);

      return ContentService
        .createTextOutput(JSON.stringify({
          success: true,
          folderId: batchFolder.getId(),
          folderName: subfolderName
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ---- STEP 2: FILE -upload one file to existing folder ----
    if (action === 'file') {
      var folder = DriveApp.getFolderById(data.folderId);
      var blob = Utilities.newBlob(
        Utilities.base64Decode(data.fileData),
        data.mimeType,
        data.fileName
      );
      folder.createFile(blob);

      return ContentService
        .createTextOutput(JSON.stringify({ success: true, fileName: data.fileName }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ---- STEP 3: FINISH -write metadata + send email ----
    if (action === 'finish') {
      var folder = DriveApp.getFolderById(data.folderId);
      var folderName = data.folderName;
      var timeHM = Utilities.formatDate(new Date(), 'America/New_York', 'HH-mm');
      var timestamp = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
      var fileNames = data.fileNames || [];

      // Create metadata text file
      var metaContent = 'Upload Batch: ' + folderName + '\n'
        + 'Uploaded by: ' + (data.uploaderName || 'Unknown') + '\n'
        + 'Time: ' + timeHM + '\n'
        + 'Files: ' + fileNames.join(', ') + '\n'
        + 'File count: ' + fileNames.length + '\n'
        + '\n--- Context ---\n'
        + 'Description: ' + (data.description || 'None') + '\n'
        + 'VIPs/Stakeholders: ' + (data.vips || 'None') + '\n'
        + 'Event/Location: ' + (data.event || 'None') + '\n'
        + 'Notes: ' + (data.notes || 'None') + '\n';
      folder.createFile(folderName + '_info.txt', metaContent, 'text/plain');

      // Collect image attachments from the folder (under 5MB each)
      var attachments = [];
      var folderFiles = folder.getFiles();
      while (folderFiles.hasNext()) {
        var f = folderFiles.next();
        var mime = f.getMimeType();
        if (mime && mime.indexOf('image/') === 0) {
          try {
            var fileBlob = f.getBlob();
            if (fileBlob.getBytes().length < 5 * 1024 * 1024) {
              attachments.push(fileBlob);
            }
          } catch (attachErr) {
            // Skip on error
          }
        }
      }

      // Generate draft caption
      var draftCaption = generateCaption(data);

      // Send email
      var emailSubject = 'JAG Media Upload -' + (data.description || 'New Upload')
        + ' (' + fileNames.length + ' file' + (fileNames.length === 1 ? '' : 's') + ')';

      var emailBody = 'New media uploaded to Social Staged\n'
        + '------------------------------\n\n'
        + 'Uploaded by: ' + (data.uploaderName || 'Unknown') + '\n'
        + 'Files: ' + fileNames.length + ' (' + fileNames.join(', ') + ')\n'
        + 'Description: ' + (data.description || 'None') + '\n'
        + 'VIPs: ' + (data.vips || 'None') + '\n'
        + 'Event/Location: ' + (data.event || 'None') + '\n'
        + 'Notes: ' + (data.notes || 'None') + '\n\n'
        + '------------------------------\n'
        + 'DRAFT CAPTION (edit as needed):\n'
        + '------------------------------\n\n'
        + draftCaption + '\n\n'
        + '------------------------------\n'
        + 'View folder in Drive: ' + folder.getUrl() + '\n'
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
        .createTextOutput(JSON.stringify({ success: true, folder: folderName, fileCount: fileNames.length }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Unknown action
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: 'Unknown action: ' + action }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Generate a draft Instagram caption in the D12 / @councilmanjjones voice.
 * Calls Claude API for a real, polished caption. Falls back to template if API fails.
 */
function generateCaption(data) {
  var desc = data.description || '';
  var vips = data.vips || '';
  var eventLoc = data.event || '';
  var notes = data.notes || '';
  var uploader = data.uploaderName || 'team member';

  // Try Claude API first
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (apiKey) {
    try {
      var caption = generateCaptionWithClaude(apiKey, desc, vips, eventLoc, notes, uploader);
      if (caption) return caption;
    } catch (err) {
      Logger.log('Claude API caption failed: ' + err.toString());
    }
  }

  // Fallback: simple template
  return generateCaptionTemplate(desc, vips, eventLoc, notes);
}

/**
 * Call Claude API to generate a polished caption.
 */
function generateCaptionWithClaude(apiKey, desc, vips, eventLoc, notes, uploader) {
  var prompt = 'Write ONE Instagram/Facebook caption for Councilman Jermaine Jones (@councilmanjjones), District 12, Baltimore.\n\n'
    + 'VOICE RULES:\n'
    + '- First-person plural: "We", "Our office", "Our community"\n'
    + '- Warm but substantive — name specific people, organizations, and places\n'
    + '- 2-3 short paragraphs + hashtags at the end\n'
    + '- Do NOT use generic filler. Be specific to the details provided.\n'
    + '- Capitalize proper nouns and organization names correctly\n'
    + '- Include a call to action when appropriate\n\n'
    + 'UPLOAD CONTEXT:\n'
    + '- Description: ' + (desc || 'Not provided') + '\n'
    + '- VIPs/Stakeholders: ' + (vips || 'Not provided') + '\n'
    + '- Event/Location: ' + (eventLoc || 'Not provided') + '\n'
    + '- Notes: ' + (notes || 'Not provided') + '\n\n'
    + 'Write ONLY the caption text (paragraphs + hashtags). No labels, no options, no explanations.';

  var payload = {
    'model': 'claude-sonnet-4-20250514',
    'max_tokens': 500,
    'messages': [{ 'role': 'user', 'content': prompt }]
  };

  var options = {
    'method': 'post',
    'contentType': 'application/json',
    'headers': {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  var result = JSON.parse(response.getContentText());

  if (result.content && result.content[0] && result.content[0].text) {
    return result.content[0].text.trim();
  }

  Logger.log('Claude API unexpected response: ' + JSON.stringify(result));
  return null;
}

/**
 * Fallback template caption when Claude API is unavailable.
 */
function generateCaptionTemplate(desc, vips, eventLoc, notes) {
  var parts = [];

  if (desc) {
    parts.push('Great to be out in the community for ' + desc + '.');
  } else {
    parts.push('Great day out in the community.');
  }

  if (vips && eventLoc) {
    parts.push('We were joined by ' + vips + ' at ' + eventLoc + '.');
  } else if (vips) {
    parts.push('We were joined by ' + vips + '.');
  } else if (eventLoc) {
    parts.push('We were out at ' + eventLoc + '.');
  }

  if (notes) {
    parts.push(notes + (!/[.!?]$/.test(notes) ? '.' : ''));
  }

  parts.push('Thank you to everyone who came out and continues to invest in our community.');

  var hashtags = ['#District12', '#Baltimore', '#ExploreDistrict12'];
  parts.push(hashtags.join(' '));

  return parts.join('\n\n');
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
