// Fonction CloudFront (viewer-request, runtime cloudfront-js-2.0) — ADR-0020.
// `www.` → domaine nu (301) ; URL propres → fichier HTML du bucket.
// Le domaine est injecté par Terraform (templatefile). Le site n'utilise
// aucun paramètre d'URL : la redirection ne les recopie pas.
function handler(event) {
  var request = event.request;
  var host = request.headers.host ? request.headers.host.value : '';

  if (host === 'www.${domain}') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: 'https://${domain}' + request.uri } },
    };
  }

  // `/conditions` → `/conditions.html` ; `/dossier/` → `/dossier/index.html`.
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (uri.split('/').pop().indexOf('.') === -1) {
    request.uri = uri + '.html';
  }
  return request;
}
