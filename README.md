# Automação de cotação HotMilhas (protótipo)

Este pacote consulta a página inicial pública da HotMilhas, tenta ler o **milheiro LATAM Pass em 150 dias corridos** e grava o resultado em `quote.json`. O fluxo está configurado para rodar diariamente às 09h15 (horário de Brasília) via GitHub Actions.

## Limitações importantes

- **Protótipo ainda não validado ponta a ponta** contra a página real. A HotMilhas pode mudar o formulário, seus seletores ou o fluxo de resultados. O script falha de forma segura e não substitui a última cotação se não conseguir confirmar o preço.
- O formulário público pede e-mail. O script só roda se você configurar um e-mail autorizado em `HOTMILHAS_EMAIL`; a submissão pode gerar comunicações da HotMilhas. Use um endereço seu e confirme que aceita esse uso.
- Não contorna CAPTCHA, bloqueios ou autenticação. Se aparecer uma proteção, a consulta deve ser feita manualmente ou por integração autorizada.
- A automação atualiza `quote.json` no repositório. O site público só consumirá essa cotação depois que seu HTML for adaptado para carregar esse JSON e o site for publicado. Isso não está conectado automaticamente neste pacote.
- Uma cotação de simulação não é garantia de que a HotMilhas aceitará ou pagará uma negociação nesse valor.

## Teste local

1. Instale Python 3.11+.
2. Na pasta do projeto, execute:
   ```bash
   pip install -r requirements.txt
   playwright install chromium
   ```
3. Defina a variável de ambiente `HOTMILHAS_EMAIL` com seu e-mail.
4. Execute `python hotmilhas_scraper.py`.
5. Confira `quote.json`. Se falhar, leia a mensagem de erro e os arquivos de diagnóstico `hotmilhas-debug.html` / `hotmilhas-debug.png`.

## Agendamento diário com GitHub Actions

1. Crie um repositório privado no GitHub e envie os arquivos desta pasta para a raiz do repositório.
2. Em **Settings → Secrets and variables → Actions**, crie o secret `HOTMILHAS_EMAIL`.
3. Em **Actions**, habilite workflows e execute **Atualizar cotação HotMilhas** manualmente para o primeiro teste.
4. Veja o log do workflow. Não considere a automação ativa até o teste gerar uma cotação correta.

O agendamento está para 09h15 de Brasília. O GitHub pode executar alguns minutos depois.

## Integração com o site

O site estático deve carregar `quote.json` da mesma origem e usar `milheiro_brl` como preço de referência, exibindo a data de atualização e um aviso de que o valor é estimado. Antes de publicar, integrar esse carregamento ao HTML v11 e testar a exibição quando o JSON estiver ausente ou desatualizado.
