# Lambda Package for Swordthain Automation

Build and deploy:

```bash
cd lambda
python3 -m pip install -r requirements.txt -t .
zip -r ../lambda.zip . -x "*.pyc" -x "__pycache__/*" -x "README.md"
cd ..
```

Then upload `lambda.zip` to the `swordthain-automation` Lambda function.

## Environment variables

- `S3_BUCKET` – bucket name (e.g. swordthain-demo-sites)
- `CLOUDFRONT_DISTRIBUTION_ID` – CloudFront distribution ID
- `AI_PROVIDER` – `openai` or `anthropic`

## Secrets Manager

Store `swordthain/ai-keys` with JSON:

```json
{
  "OPENAI_API_KEY": "...",
  "ANTHROPIC_API_KEY": "..."
}
```
