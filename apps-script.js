// ============================================================
// JAG Media Upload — Google Apps Script Backend
// ============================================================
// SETUP INSTRUCTIONS:
// 1. Go to https://script.google.com
// 2. Click "New project"
// 3. Delete the default code and paste this entire file
// 4. Click "Deploy" > "New deployment"
// 5. Type = "Web app"
// 6. Execute as = "Me"
// 7. Who has access = "Anyone"
// 8. Click "Deploy" and authorize when prompted
// 9. Copy the web app URL — give it to Claude to wire into the portal
// ============================================================

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // Get or create the target folder: D12 Pipeline/Social Staged
    var folder = getOrCreateFolder('D12 Pipeline/Social Staged');

    // Upload the file
    var blob = Utilities.newBlob(
      Utilities.base64Decode(data.file),
      data.mimeType,
      data.filename
    );
    var file = folder.createFile(blob);

    // Create a metadata text file alongside the media
    var timestamp = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd_HH-mm');
    var metaName = timestamp + '_' + data.filename.replace(/\.[^.]+$/, '') + '_info.txt';
    var metaContent = 'Uploaded: ' + timestamp + '\n'
      + 'File: ' + data.filename + '\n'
      + 'Description: ' + (data.description || 'None') + '\n'
      + 'VIPs/Stakeholders: ' + (data.vips || 'None') + '\n'
      + 'Event/Location: ' + (data.event || 'None') + '\n'
      + 'Notes: ' + (data.notes || 'None') + '\n';
    folder.createFile(metaName, metaContent, 'text/plain');

    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
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
