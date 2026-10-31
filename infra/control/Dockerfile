FROM python:3.12-slim
WORKDIR /srv
COPY control ./control
COPY sites.json ./sites.json
RUN mkdir /data && chmod 700 /data
CMD ["python", "-m", "control.server"]
